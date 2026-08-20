-- Quota Apify autoritaire en unité honnête : nombre de runs Actor.
-- `usageTotalUsd`, observé après terminaison par le poller, reste un coût et
-- n'est jamais utilisé comme unité de plafond.

ALTER TABLE public.apify_plan_settings
  ADD COLUMN IF NOT EXISTS monthly_run_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quota_unit text NOT NULL DEFAULT 'actor_runs';

ALTER TABLE public.apify_plan_settings
  ALTER COLUMN plan_name SET DEFAULT 'Non configuré',
  ALTER COLUMN monthly_credits SET DEFAULT 0,
  ALTER COLUMN cost_per_scrape SET DEFAULT 0;

-- Le seed Starter/5000 historique ne prouve aucun forfait souscrit. Seule la
-- ligne restée strictement intacte est neutralisée ; toute configuration
-- réellement enregistrée reste visible mais doit définir le nouveau plafond.
UPDATE public.apify_plan_settings
SET plan_name = 'Non configuré',
    monthly_credits = 0,
    monthly_run_limit = 0,
    cost_per_scrape = 0
WHERE plan_name = 'Starter'
  AND monthly_credits = 5000
  AND cost_per_scrape = 0.5
  AND alert_threshold_percent = 80
  AND current_period_start = date_trunc('month', created_at AT TIME ZONE 'UTC')::date
  AND current_period_end = (
    date_trunc('month', created_at AT TIME ZONE 'UTC') + interval '1 month - 1 day'
  )::date
  AND updated_at = created_at;

DO $$ BEGIN
  ALTER TABLE public.apify_plan_settings
    ADD CONSTRAINT apify_plan_run_quota_check CHECK (
      monthly_run_limit >= 0
      AND quota_unit = 'actor_runs'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.apify_plan_settings.monthly_run_limit IS
  'Plafond contractuel explicite de démarrages de runs Actor Apify sur la période.';
COMMENT ON COLUMN public.apify_plan_settings.quota_unit IS
  'Unité autoritaire du plafond Apify: actor_runs. Ne représente ni crédits ni USD.';
COMMENT ON COLUMN public.apify_plan_settings.monthly_credits IS
  'Champ historique non autoritaire, conservé pour compatibilité; ne doit plus piloter les appels.';
COMMENT ON COLUMN public.apify_plan_settings.cost_per_scrape IS
  'Estimation historique non autoritaire; le coût exact est usageTotalUsd sur la run terminale.';

CREATE OR REPLACE FUNCTION public.apify_actor_run_quota_status(
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  plan public.apify_plan_settings%ROWTYPE;
  v_at timestamptz := COALESCE(p_at, now());
  v_cutover timestamptz;
  v_legacy_runs numeric := 0;
  v_reserved_or_used numeric := 0;
  v_period_current boolean := false;
  v_limit integer := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Compte interne requis' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO plan FROM public.apify_plan_settings LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'configured', false,
      'reason', 'plan_missing',
      'unit', 'actor_runs',
      'limit', 0,
      'used', 0,
      'remaining', 0,
      'period_current', false,
      'measured_at', v_at
    );
  END IF;

  v_period_current := (v_at AT TIME ZONE 'UTC')::date
    BETWEEN plan.current_period_start AND plan.current_period_end;
  v_limit := CASE WHEN v_period_current THEN plan.monthly_run_limit ELSE 0 END;

  SELECT measurement_started_at INTO v_cutover
  FROM public.provider_measurement_state
  WHERE provider = 'apify_actor_runs';
  v_cutover := COALESCE(v_cutover, v_at);

  SELECT COALESCE(sum(requests_count), 0) INTO v_legacy_runs
  FROM public.provider_usage_events
  WHERE provider = 'apify'
    AND operation IN ('linkedin_company_search', 'linkedin_employee_submit')
    AND occurred_at < v_cutover
    AND (occurred_at AT TIME ZONE 'UTC')::date
      BETWEEN plan.current_period_start AND plan.current_period_end;

  SELECT COALESCE(sum(
    CASE
      WHEN status = 'reserved' THEN reserved_units
      ELSE COALESCE(actual_units, reserved_units)
    END
  ), 0) INTO v_reserved_or_used
  FROM public.provider_quota_reservations
  WHERE provider = 'apify'
    AND operation IN ('linkedin_company_search', 'linkedin_employee_submit')
    AND status <> 'expired'
    AND (occurred_at AT TIME ZONE 'UTC')::date
      BETWEEN plan.current_period_start AND plan.current_period_end;

  RETURN jsonb_build_object(
    'configured', v_period_current AND v_limit > 0,
    'reason', CASE
      WHEN NOT v_period_current THEN 'period_not_current'
      WHEN v_limit <= 0 THEN 'plan_zero'
      WHEN v_legacy_runs + v_reserved_or_used >= v_limit THEN 'plan_exhausted'
      ELSE 'ok'
    END,
    'unit', 'actor_runs',
    'limit', v_limit,
    'legacy_runs', v_legacy_runs,
    'reserved_or_used_runs', v_reserved_or_used,
    'used', v_legacy_runs + v_reserved_or_used,
    'remaining', GREATEST(0, v_limit - v_legacy_runs - v_reserved_or_used),
    'period_start', plan.current_period_start,
    'period_end', plan.current_period_end,
    'period_current', v_period_current,
    'measurement_started_at', v_cutover,
    'measured_at', v_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_apify_actor_run(
  p_request_key text,
  p_operation text,
  p_run_id uuid,
  p_signal_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  plan public.apify_plan_settings%ROWTYPE;
  existing public.provider_quota_reservations%ROWTYPE;
  quota jsonb;
  reservation_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_request_key), '') = ''
     OR p_operation NOT IN ('linkedin_company_search', 'linkedin_employee_submit')
     OR p_run_id IS NULL
     OR p_signal_id IS NULL THEN
    RAISE EXCEPTION 'Réservation Apify invalide' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:apify:actor-run-quota', 0));

  SELECT * INTO existing
  FROM public.provider_quota_reservations
  WHERE provider = 'apify' AND request_key = p_request_key
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'existing_reservation',
      'reservation_id', existing.id,
      'status', existing.status,
      'dispatch_state', existing.metadata->>'dispatch_state'
    );
  END IF;

  SELECT * INTO plan FROM public.apify_plan_settings LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan Apify absent' USING ERRCODE = '55000';
  END IF;
  IF plan.quota_unit <> 'actor_runs' OR plan.monthly_run_limit <= 0 THEN
    RAISE EXCEPTION 'Plan Apify non configuré (plafond runs à 0)' USING ERRCODE = '55000';
  END IF;
  IF current_date < plan.current_period_start OR current_date > plan.current_period_end THEN
    RAISE EXCEPTION 'Période Apify non courante: % - %',
      plan.current_period_start, plan.current_period_end USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.provider_measurement_state(provider, measurement_started_at, metadata)
  VALUES (
    'apify_actor_runs',
    now(),
    jsonb_build_object('unit', 'actor_runs', 'source', 'atomic_quota_reservations')
  )
  ON CONFLICT (provider) DO NOTHING;

  quota := public.apify_actor_run_quota_status(now());
  IF (quota->>'used')::numeric + 1 > plan.monthly_run_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_run_quota_exhausted',
      'used', (quota->>'used')::numeric,
      'limit', plan.monthly_run_limit,
      'unit', 'actor_runs'
    );
  END IF;

  INSERT INTO public.provider_quota_reservations(
    provider, operation, request_key, run_id, reserved_units, status,
    occurred_at, expires_at, metadata
  ) VALUES (
    'apify', p_operation, p_request_key, p_run_id, 1, 'reserved',
    now(),
    ((plan.current_period_end + 1)::timestamp AT TIME ZONE 'UTC'),
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'dispatch_state', 'prepared',
      'quota_unit', 'actor_runs',
      'signal_id', p_signal_id
    )
  ) RETURNING id INTO reservation_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', reservation_id,
    'used_before', (quota->>'used')::numeric,
    'used_after', (quota->>'used')::numeric + 1,
    'limit', plan.monthly_run_limit,
    'unit', 'actor_runs'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_apify_actor_run_dispatched(
  p_request_key text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  updated_count integer;
  plan public.apify_plan_settings%ROWTYPE;
  quota jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:apify:actor-run-quota', 0));

  SELECT * INTO plan FROM public.apify_plan_settings LIMIT 1;
  IF NOT FOUND
     OR plan.quota_unit <> 'actor_runs'
     OR plan.monthly_run_limit <= 0
     OR current_date < plan.current_period_start
     OR current_date > plan.current_period_end THEN
    RAISE EXCEPTION 'Plan Apify absent, nul ou hors période' USING ERRCODE = '55000';
  END IF;

  quota := public.apify_actor_run_quota_status(now());
  IF (quota->>'used')::numeric > plan.monthly_run_limit THEN
    RAISE EXCEPTION 'Plafond Apify dépassé avant dispatch' USING ERRCODE = '55000';
  END IF;

  UPDATE public.provider_quota_reservations
  SET attempted_at = COALESCE(attempted_at, now()),
      metadata = metadata || jsonb_build_object(
        'dispatch_state', 'dispatched',
        'dispatched_at', now()
      )
  WHERE provider = 'apify'
    AND request_key = p_request_key
    AND status = 'reserved'
    AND expires_at > now()
    AND metadata->>'dispatch_state' = 'prepared';
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_apify_actor_run(
  p_request_key text,
  p_success boolean,
  p_provider_request_id text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_items_count integer DEFAULT 0,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  reservation public.provider_quota_reservations%ROWTYPE;
  final_status text;
  stored_provider_request_id text;
  usage_event_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_request_key), '') = ''
     OR p_success IS NULL
     OR p_items_count IS NULL
     OR p_items_count < 0 THEN
    RAISE EXCEPTION 'Finalisation Apify invalide' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:apify:actor-run-quota', 0));
  final_status := CASE WHEN p_success THEN 'completed' ELSE 'failed' END;
  SELECT * INTO reservation
  FROM public.provider_quota_reservations
  WHERE provider = 'apify' AND request_key = p_request_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Réservation Apify introuvable: %', p_request_key USING ERRCODE = 'P0002';
  END IF;

  stored_provider_request_id := NULLIF(reservation.metadata->>'provider_request_id', '');
  IF reservation.status IN ('completed', 'failed') THEN
    IF reservation.status <> final_status
       OR stored_provider_request_id IS DISTINCT FROM NULLIF(trim(p_provider_request_id), '') THEN
      RAISE EXCEPTION 'Preuve fournisseur Apify divergente: %', p_request_key USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'reservation_id', reservation.id,
      'status', reservation.status,
      'already_completed', true,
      'unit', 'actor_runs'
    );
  END IF;
  IF reservation.status <> 'reserved'
     OR reservation.metadata->>'dispatch_state' <> 'dispatched' THEN
    RAISE EXCEPTION 'Réservation Apify non finalisable: %', p_request_key USING ERRCODE = '55000';
  END IF;

  UPDATE public.provider_quota_reservations
  SET actual_units = 1,
      status = final_status,
      completed_at = now(),
      error_code = CASE WHEN p_success THEN NULL ELSE COALESCE(p_error_code, 'provider_error') END,
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
        'dispatch_state', 'completed',
        'provider_request_id', NULLIF(trim(p_provider_request_id), ''),
        'http_status', p_http_status,
        'quota_unit', 'actor_runs',
        'completed_at', now()
      )
  WHERE id = reservation.id;

  -- La preuve d'appel et la finalisation du quota partagent la même
  -- transaction. Un échec d'écriture du ledger annule aussi la finalisation :
  -- le cache durable permettra au retry de rejouer cette RPC, jamais le POST.
  INSERT INTO public.provider_usage_events(
    provider, operation, run_id, signal_id, request_key, units,
    requests_count, items_count, success, error_code, occurred_at, metadata
  ) VALUES (
    'apify', reservation.operation, reservation.run_id,
    NULLIF(reservation.metadata->>'signal_id', '')::uuid,
    p_request_key, 0, 1, p_items_count, p_success,
    CASE WHEN p_success THEN NULL ELSE COALESCE(p_error_code, 'provider_error') END,
    COALESCE(reservation.attempted_at, reservation.occurred_at),
    reservation.metadata || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'quota_reservation_id', reservation.id,
      'provider_request_id', NULLIF(trim(p_provider_request_id), ''),
      'http_status', p_http_status,
      'quota_unit', 'actor_runs',
      'unit_basis', 'not_returned_by_provider'
    )
  )
  ON CONFLICT (provider, request_key) WHERE request_key IS NOT NULL
  DO UPDATE SET
    items_count = EXCLUDED.items_count,
    success = EXCLUDED.success,
    error_code = EXCLUDED.error_code,
    metadata = public.provider_usage_events.metadata || EXCLUDED.metadata
  RETURNING id INTO usage_event_id;

  RETURN jsonb_build_object(
    'reservation_id', reservation.id,
    'status', final_status,
    'already_completed', false,
    'actual_units', 1,
    'usage_event_id', usage_event_id,
    'unit', 'actor_runs'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apify_actor_run_quota_status(timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_apify_actor_run(text, text, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_apify_actor_run_dispatched(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_apify_actor_run(text, boolean, text, integer, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apify_actor_run_quota_status(timestamptz)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_apify_actor_run(text, text, uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_apify_actor_run_dispatched(text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_apify_actor_run(text, boolean, text, integer, text, integer, jsonb)
  TO service_role;

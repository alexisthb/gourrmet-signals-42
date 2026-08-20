-- Quota Pappers transactionnel et baux de run. Une réservation protège le
-- plafond avant l'appel HTTP ; seule une finalisation post-tentative alimente le
-- ledger fournisseur. Les réservations orphelines/indécidables restent comptées
-- dans le plafond, sans être présentées comme des crédits effectivement facturés.

-- La route officielle /recherche-publications ne garantit que type/date/contenu,
-- sans SIREN ni dénomination. Ces requêtes historiques restent consultables mais
-- sont désactivées afin de ne jamais inventer l'identité d'une société.
UPDATE public.pappers_queries
SET is_active = false,
    updated_at = now()
WHERE type IN ('nomination', 'capital_increase', 'transfer')
  AND is_active IS DISTINCT FROM false;

-- Réimposé ici (et pas seulement dans la foundation rétrodatée) pour qu'un
-- déploiement incrémental 202608 ne puisse jamais exécuter les RPC de quota sur
-- plusieurs plans concurrents.
WITH ranked_plans AS (
  SELECT id, row_number() OVER (
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ) AS position
  FROM public.pappers_plan_settings
)
DELETE FROM public.pappers_plan_settings AS settings
USING ranked_plans
WHERE settings.id = ranked_plans.id
  AND ranked_plans.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS pappers_plan_settings_singleton
  ON public.pappers_plan_settings ((true));

DO $$ BEGIN
  ALTER TABLE public.pappers_plan_settings
    ADD CONSTRAINT pappers_plan_settings_period_check
    CHECK (current_period_end >= current_period_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.pappers_credit_usage
  ADD COLUMN IF NOT EXISTS reserved_credits numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS success boolean,
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS error_code text;

UPDATE public.pappers_credit_usage
SET reserved_credits = CASE
      WHEN details->>'status' = 'reserved' THEN
        greatest(0, CASE
          WHEN details->>'reserved_credits' ~ '^[0-9]+([.][0-9]+)?$'
            THEN (details->>'reserved_credits')::numeric
          ELSE 1
        END)
      ELSE 0
    END,
    reservation_status = CASE
      WHEN details->>'status' = 'reserved' THEN 'reserved'
      ELSE 'completed'
    END
WHERE reservation_status = 'completed'
  AND reserved_credits = 0
  AND details ? 'status';

DO $$ BEGIN
  ALTER TABLE public.pappers_credit_usage
    ADD CONSTRAINT pappers_credit_usage_reserved_credits_check
    CHECK (reserved_credits >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.pappers_credit_usage
    ADD CONSTRAINT pappers_credit_usage_reservation_status_check
    CHECK (reservation_status IN ('reserved', 'completed', 'uncertain'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS pappers_credit_usage_reservation_status_idx
  ON public.pappers_credit_usage(reservation_status)
  WHERE reservation_status <> 'completed';

CREATE OR REPLACE FUNCTION public.reserve_pappers_credits(
  p_request_key text,
  p_operation text,
  p_reserved_credits numeric,
  p_query_id uuid DEFAULT NULL,
  p_scan_id uuid DEFAULT NULL,
  p_signal_id uuid DEFAULT NULL,
  p_run_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  plan public.pappers_plan_settings%ROWTYPE;
  committed numeric := 0;
  usage_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_request_key), '') = '' THEN
    RAISE EXCEPTION 'request_key Pappers obligatoire' USING ERRCODE = '22023';
  END IF;
  IF p_operation NOT IN ('recherche', 'publications', 'entreprise') THEN
    RAISE EXCEPTION 'Opération Pappers inconnue: %', p_operation USING ERRCODE = '22023';
  END IF;
  IF p_reserved_credits IS NULL OR p_reserved_credits <= 0 THEN
    RAISE EXCEPTION 'Réservation Pappers invalide: %', p_reserved_credits USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:credits', 0));

  IF EXISTS (SELECT 1 FROM public.pappers_credit_usage WHERE request_key = p_request_key) THEN
    RAISE EXCEPTION 'appel Pappers déjà réservé: %', p_request_key USING ERRCODE = '23505';
  END IF;

  SELECT * INTO plan FROM public.pappers_plan_settings;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan Pappers absent' USING ERRCODE = '55000';
  END IF;
  IF plan.monthly_credits <= 0 THEN
    RAISE EXCEPTION 'plan Pappers non configuré (quota à 0)' USING ERRCODE = '55000';
  END IF;
  IF current_date < plan.current_period_start OR current_date > plan.current_period_end THEN
    RAISE EXCEPTION 'période Pappers non courante: % - %',
      plan.current_period_start, plan.current_period_end USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(sum(credits_used + reserved_credits), 0)
  INTO committed
  FROM public.pappers_credit_usage
  WHERE date BETWEEN plan.current_period_start AND plan.current_period_end;

  IF committed + p_reserved_credits > plan.monthly_credits THEN
    RAISE EXCEPTION 'quota Pappers insuffisant: %/% + %',
      committed, plan.monthly_credits, p_reserved_credits USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.pappers_credit_usage (
    date, credits_used, reserved_credits, search_credits, company_credits,
    api_calls, query_id, scan_id, request_key, reservation_status, details
  ) VALUES (
    current_date, 0, p_reserved_credits, 0, 0,
    0, p_query_id, p_scan_id, p_request_key, 'reserved',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'operation', p_operation,
      'signal_id', p_signal_id,
      'run_id', p_run_id,
      'reserved_credits', p_reserved_credits,
      'reserved_at', now()
    )
  )
  RETURNING id INTO usage_id;

  RETURN jsonb_build_object(
    'usage_id', usage_id,
    'request_key', p_request_key,
    'reserved_credits', p_reserved_credits,
    'committed_before', committed,
    'committed_after', committed + p_reserved_credits,
    'limit', plan.monthly_credits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pappers_credits(
  p_usage_id uuid,
  p_request_key text,
  p_actual_credits numeric,
  p_items_count integer,
  p_success boolean,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL,
  p_attempted_at timestamptz DEFAULT now(),
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  usage public.pappers_credit_usage%ROWTYPE;
  v_operation text;
  v_signal_id uuid;
  v_run_id uuid;
  billed_known boolean;
  final_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_items_count IS NULL OR p_items_count < 0 THEN
    RAISE EXCEPTION 'items_count Pappers invalide: %', p_items_count USING ERRCODE = '22023';
  END IF;
  IF p_actual_credits IS NOT NULL AND p_actual_credits < 0 THEN
    RAISE EXCEPTION 'crédits Pappers invalides: %', p_actual_credits USING ERRCODE = '22023';
  END IF;
  IF p_success AND p_actual_credits IS NULL THEN
    RAISE EXCEPTION 'une tentative réussie doit avoir un coût connu' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:credits', 0));

  SELECT * INTO usage
  FROM public.pappers_credit_usage
  WHERE id = p_usage_id AND request_key = p_request_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'réservation Pappers introuvable: %', p_request_key USING ERRCODE = 'P0002';
  END IF;
  IF usage.reservation_status <> 'reserved' THEN
    RAISE EXCEPTION 'réservation Pappers déjà finalisée: %', p_request_key USING ERRCODE = '55000';
  END IF;
  IF p_actual_credits IS NOT NULL AND p_actual_credits > usage.reserved_credits THEN
    RAISE EXCEPTION 'coût Pappers % supérieur à la réservation %',
      p_actual_credits, usage.reserved_credits USING ERRCODE = '22023';
  END IF;

  v_operation := usage.details->>'operation';
  IF v_operation NOT IN ('recherche', 'publications', 'entreprise') THEN
    RAISE EXCEPTION 'opération de réservation Pappers invalide: %', v_operation USING ERRCODE = '22023';
  END IF;
  v_signal_id := nullif(usage.details->>'signal_id', '')::uuid;
  v_run_id := nullif(usage.details->>'run_id', '')::uuid;
  billed_known := p_actual_credits IS NOT NULL;
  final_status := CASE WHEN billed_known THEN 'completed' ELSE 'uncertain' END;

  UPDATE public.pappers_credit_usage
  SET credits_used = coalesce(p_actual_credits, 0),
      reserved_credits = CASE WHEN billed_known THEN 0 ELSE reserved_credits END,
      search_credits = CASE
        WHEN billed_known AND v_operation IN ('recherche', 'publications') THEN p_actual_credits
        ELSE 0
      END,
      company_credits = CASE
        WHEN billed_known AND v_operation = 'entreprise' THEN p_actual_credits
        ELSE 0
      END,
      api_calls = 1,
      reservation_status = final_status,
      attempted_at = coalesce(p_attempted_at, now()),
      finalized_at = now(),
      success = p_success,
      http_status = p_http_status,
      error_code = p_error_code,
      details = coalesce(details, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'status', final_status,
          'billing_known', billed_known,
          'http_status', p_http_status,
          'error_code', p_error_code,
          'finalized_at', now()
        )
  WHERE id = usage.id;

  INSERT INTO public.provider_usage_events (
    provider, operation, run_id, query_id, signal_id, request_key,
    units, requests_count, items_count, success, error_code, metadata, occurred_at
  ) VALUES (
    'pappers',
    CASE WHEN billed_known THEN v_operation ELSE v_operation || '_billing_unknown' END,
    v_run_id, usage.query_id, v_signal_id, p_request_key,
    coalesce(p_actual_credits, 0), 1, p_items_count, p_success, p_error_code,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'http_status', p_http_status,
      'endpoint', v_operation,
      'billing_known', billed_known,
      'reserved_credits', usage.reserved_credits,
      'pappers_credit_usage_id', usage.id
    ),
    coalesce(p_attempted_at, now())
  );

  RETURN jsonb_build_object(
    'usage_id', usage.id,
    'reservation_status', final_status,
    'actual_credits', p_actual_credits,
    'reserved_credits_remaining', CASE WHEN billed_known THEN 0 ELSE usage.reserved_credits END
  );
END;
$$;

-- Compatibilité du chemin /entreprise utilisé par l'enrichissement. Toute
-- nouvelle consommation passe malgré tout par le même verrou et le même ledger.
CREATE OR REPLACE FUNCTION public.reserve_pappers_company_credit(
  p_request_key text,
  p_signal_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT public.reserve_pappers_credits(
    p_request_key => p_request_key,
    p_operation => 'entreprise',
    p_reserved_credits => 1,
    p_signal_id => p_signal_id,
    p_run_id => p_run_id,
    p_metadata => jsonb_build_object('source', 'contact_enrichment')
  );
$$;

CREATE OR REPLACE FUNCTION public.complete_pappers_company_credit(
  p_usage_id uuid,
  p_request_key text,
  p_signal_id uuid,
  p_run_id uuid,
  p_success boolean,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  PERFORM public.complete_pappers_credits(
    p_usage_id => p_usage_id,
    p_request_key => p_request_key,
    p_actual_credits => CASE WHEN p_success THEN 1 ELSE NULL END,
    p_items_count => CASE WHEN p_success THEN 1 ELSE 0 END,
    p_success => p_success,
    p_http_status => p_http_status,
    p_error_code => p_error_code,
    p_attempted_at => now(),
    p_metadata => jsonb_build_object(
      'signal_id', p_signal_id,
      'run_id', p_run_id,
      'source', 'contact_enrichment'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_pappers_credits(text, text, numeric, uuid, uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_pappers_credits(uuid, text, numeric, integer, boolean, integer, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_pappers_credits(text, text, numeric, uuid, uuid, uuid, uuid, jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pappers_credits(uuid, text, numeric, integer, boolean, integer, text, timestamptz, jsonb)
  TO service_role;

-- Agrégation côté PostgreSQL : le solde ne dépend pas de la limite de lignes
-- PostgREST, déjà dépassée par l'historique live.
CREATE OR REPLACE FUNCTION public.get_pappers_quota_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  plan public.pappers_plan_settings%ROWTYPE;
  used numeric := 0;
  reserved numeric := 0;
  period_current boolean := false;
  effective_limit numeric := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO plan FROM public.pappers_plan_settings;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan Pappers absent' USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(sum(credits_used), 0), coalesce(sum(reserved_credits), 0)
  INTO used, reserved
  FROM public.pappers_credit_usage
  WHERE date BETWEEN plan.current_period_start AND plan.current_period_end;

  period_current := current_date BETWEEN plan.current_period_start AND plan.current_period_end;
  effective_limit := CASE WHEN period_current AND plan.monthly_credits > 0 THEN plan.monthly_credits ELSE 0 END;

  RETURN jsonb_build_object(
    'used', used,
    'reserved', reserved,
    'committed', used + reserved,
    'configured_limit', plan.monthly_credits,
    'effective_limit', effective_limit,
    'remaining', greatest(0, effective_limit - used - reserved),
    'percent', CASE
      WHEN effective_limit > 0 THEN round(((used + reserved) / effective_limit) * 100)
      ELSE 100
    END,
    'period_start', plan.current_period_start,
    'period_end', plan.current_period_end,
    'period_current', period_current,
    'source', CASE
      WHEN effective_limit > 0 THEN 'configured_and_metered'
      ELSE 'unconfigured_or_period_invalid'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pappers_quota_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pappers_quota_status() TO service_role;

-- Un token de bail clôt les écritures d'un ancien worker après récupération du
-- run. Quinze minutes laissent largement passer les appels HTTP avec retries ;
-- chaque checkpoint et chaque tentative renouvelle le bail.
ALTER TABLE public.pappers_scan_progress
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token uuid;

UPDATE public.pappers_scan_progress
SET heartbeat_at = coalesce(updated_at, created_at, now()),
    lease_expires_at = greatest(coalesce(updated_at, created_at, now()) + interval '15 minutes', now() + interval '2 minutes'),
    lease_token = coalesce(lease_token, gen_random_uuid())
WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS pappers_scan_progress_lease_idx
  ON public.pappers_scan_progress(lease_expires_at)
  WHERE status IN ('pending', 'running');

CREATE OR REPLACE FUNCTION public.start_pappers_scan(
  p_query_id uuid DEFAULT NULL,
  p_scan_type text DEFAULT 'all_queries',
  p_lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  new_scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;
  IF p_scan_type NOT IN ('query', 'all_queries') THEN
    RAISE EXCEPTION 'type de scan Pappers invalide: %', p_scan_type USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));

  UPDATE public.pappers_scan_progress
  SET status = 'error',
      completed_at = now(),
      error_message = 'Bail expiré: run Pappers récupéré avant un nouveau démarrage',
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE status IN ('pending', 'running')
    AND (lease_expires_at IS NULL OR lease_expires_at <= now());

  IF EXISTS (
    SELECT 1 FROM public.pappers_scan_progress
    WHERE status IN ('pending', 'running', 'paused')
  ) THEN
    RAISE EXCEPTION 'un scan Pappers est déjà actif' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.pappers_scan_progress (
    query_id, scan_type, status, current_page, processed_results,
    heartbeat_at, lease_expires_at, lease_token
  ) VALUES (
    p_query_id, p_scan_type, 'pending', 0, 0,
    now(), now() + make_interval(secs => p_lease_seconds), token
  )
  RETURNING * INTO new_scan;

  RETURN jsonb_build_object(
    'scan_id', new_scan.id,
    'lease_token', token,
    'status', new_scan.status,
    'lease_expires_at', new_scan.lease_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_pappers_scan(
  p_scan_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  claimed_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;
  IF scan.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'bail Pappers invalide ou remplacé' USING ERRCODE = '55000';
  END IF;
  IF scan.status NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'run Pappers non réclamable: %', scan.status USING ERRCODE = '55000';
  END IF;
  IF scan.status = 'running' AND scan.lease_expires_at > now() THEN
    RAISE EXCEPTION 'run Pappers déjà réclamé par un worker actif' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'running',
      started_at = coalesce(started_at, now()),
      completed_at = NULL,
      error_message = NULL,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = claimed_token
  WHERE id = scan.id;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', claimed_token,
    'status', 'running',
    'last_cursor', scan.last_cursor,
    'processed_results', scan.processed_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_pappers_scan(
  p_scan_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;
  UPDATE public.pappers_scan_progress
  SET heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = p_scan_id
    AND lease_token = p_lease_token
    AND status = 'running'
    AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_pappers_scan(
  p_scan_id uuid,
  p_lease_seconds integer DEFAULT 900
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  UPDATE public.pappers_scan_progress
  SET status = 'error',
      completed_at = now(),
      error_message = 'Bail expiré: run Pappers récupéré avant une reprise',
      lease_token = NULL,
      lease_expires_at = NULL
  WHERE id <> p_scan_id
    AND status IN ('pending', 'running')
    AND (lease_expires_at IS NULL OR lease_expires_at <= now());

  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;
  IF scan.status NOT IN ('paused', 'error') THEN
    RAISE EXCEPTION 'run Pappers non reprenable: %', scan.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pappers_scan_progress
    WHERE id <> p_scan_id AND status IN ('pending', 'running', 'paused')
  ) THEN
    RAISE EXCEPTION 'un autre scan Pappers est déjà actif' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'pending',
      completed_at = NULL,
      error_message = NULL,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = token
  WHERE id = scan.id;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', token,
    'status', 'pending',
    'query_id', scan.query_id,
    'lease_expires_at', now() + make_interval(secs => p_lease_seconds)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_pappers_scan(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pappers_scan(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_pappers_scan(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_pappers_scan(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_pappers_scan(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pappers_scan(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_pappers_scan(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_pappers_scan(uuid, integer) TO service_role;

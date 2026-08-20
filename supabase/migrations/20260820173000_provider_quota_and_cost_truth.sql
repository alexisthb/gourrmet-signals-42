-- Sépare l'autorité de quota des appels effectivement tentés. Une réservation
-- protège le plafond mais ne devient jamais, à elle seule, une consommation ou
-- un coût fournisseur.
CREATE TABLE IF NOT EXISTS public.provider_measurement_state (
  provider text PRIMARY KEY,
  measurement_started_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_quota_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  operation text NOT NULL,
  request_key text NOT NULL,
  run_id uuid,
  query_id uuid,
  reserved_units numeric NOT NULL CHECK (reserved_units > 0),
  actual_units numeric CHECK (actual_units IS NULL OR actual_units >= 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'completed', 'failed', 'expired')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, request_key)
);

CREATE INDEX IF NOT EXISTS provider_quota_reservations_daily_idx
  ON public.provider_quota_reservations(provider, occurred_at, status);

ALTER TABLE public.provider_measurement_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_quota_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_measurement_state_service_all ON public.provider_measurement_state;
CREATE POLICY provider_measurement_state_service_all ON public.provider_measurement_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS provider_quota_reservations_service_all ON public.provider_quota_reservations;
CREATE POLICY provider_quota_reservations_service_all ON public.provider_quota_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.provider_measurement_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_quota_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.provider_measurement_state TO service_role;
GRANT ALL ON public.provider_quota_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.newsapi_quota_status(
  p_daily_limit integer,
  p_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_at timestamptz := COALESCE(p_at, now());
  v_day date := (COALESCE(p_at, now()) AT TIME ZONE 'UTC')::date;
  v_started_at timestamptz;
  v_legacy_units numeric := 0;
  v_reserved_or_used numeric := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Compte interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_daily_limit IS NULL OR p_daily_limit <= 0 THEN
    RAISE EXCEPTION 'Plafond NewsAPI absent ou nul' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:newsapi:daily-quota', 0));

  INSERT INTO public.provider_measurement_state(provider, measurement_started_at, metadata)
  VALUES ('newsapi', now(), jsonb_build_object('cutover_day', current_date))
  ON CONFLICT (provider) DO NOTHING;

  SELECT measurement_started_at INTO STRICT v_started_at
  FROM public.provider_measurement_state
  WHERE provider = 'newsapi';

  -- Le jour du cutover, les appels de l'ancien ledger restent comptés jusqu'à
  -- la première utilisation de cette autorité. Les écritures post-cutover ne
  -- sont comptées qu'une fois, via les réservations ci-dessous.
  SELECT COALESCE(sum(requests_count), 0) INTO v_legacy_units
  FROM public.newsapi_usage
  WHERE date = v_day
    AND created_at < v_started_at;

  SELECT COALESCE(sum(
    CASE
      WHEN status = 'reserved' THEN reserved_units
      ELSE COALESCE(actual_units, reserved_units)
    END
  ), 0) INTO v_reserved_or_used
  FROM public.provider_quota_reservations
  WHERE provider = 'newsapi'
    AND (occurred_at AT TIME ZONE 'UTC')::date = v_day
    AND status <> 'expired';

  RETURN jsonb_build_object(
    'measurement_started_at', v_started_at,
    'day', v_day,
    'legacy_units', v_legacy_units,
    'reserved_or_used_units', v_reserved_or_used,
    'used', v_legacy_units + v_reserved_or_used,
    'limit', p_daily_limit,
    'remaining', GREATEST(0, p_daily_limit - v_legacy_units - v_reserved_or_used),
    'measured_at', v_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_newsapi_request(
  p_request_key text,
  p_run_id uuid,
  p_query_id uuid,
  p_daily_limit integer,
  p_occurred_at timestamptz,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_at timestamptz := COALESCE(p_occurred_at, now());
  v_quota jsonb;
  v_used numeric;
  v_id uuid;
  v_expires_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_request_key), '') = ''
     OR p_daily_limit IS NULL
     OR p_daily_limit <= 0 THEN
    RAISE EXCEPTION 'Paramètres de réservation NewsAPI invalides' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:newsapi:daily-quota', 0));

  IF EXISTS (
    SELECT 1
    FROM public.provider_quota_reservations
    WHERE provider = 'newsapi'
      AND query_id = p_query_id
      AND status = 'reserved'
  ) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'query_dispatch_unconfirmed'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.provider_quota_reservations
    WHERE provider = 'newsapi' AND request_key = p_request_key
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_request_key');
  END IF;

  v_quota := public.newsapi_quota_status(p_daily_limit, v_at);
  v_used := (v_quota->>'used')::numeric;
  IF v_used + 1 > p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_quota_exhausted',
      'used', v_used,
      'limit', p_daily_limit,
      'measurement_started_at', v_quota->>'measurement_started_at'
    );
  END IF;

  v_expires_at := (((v_at AT TIME ZONE 'UTC')::date + 1)::timestamp AT TIME ZONE 'UTC');
  INSERT INTO public.provider_quota_reservations(
    provider, operation, request_key, run_id, query_id, reserved_units,
    status, occurred_at, expires_at, metadata
  ) VALUES (
    'newsapi', 'everything', p_request_key, p_run_id, p_query_id, 1,
    'reserved', v_at, v_expires_at, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_id', v_id,
    'used_before', v_used,
    'used_after', v_used + 1,
    'limit', p_daily_limit,
    'measurement_started_at', v_quota->>'measurement_started_at'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_newsapi_request(
  p_request_key text,
  p_items_count integer,
  p_success boolean,
  p_error_code text DEFAULT NULL,
  p_http_status integer DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reservation public.provider_quota_reservations%ROWTYPE;
  v_event_id uuid;
  v_status text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(trim(p_request_key), '') = ''
     OR p_items_count IS NULL
     OR p_items_count < 0
     OR p_success IS NULL THEN
    RAISE EXCEPTION 'Finalisation NewsAPI invalide' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_reservation
  FROM public.provider_quota_reservations
  WHERE provider = 'newsapi' AND request_key = p_request_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Réservation NewsAPI introuvable: %', p_request_key USING ERRCODE = 'P0002';
  END IF;

  v_status := CASE WHEN p_success THEN 'completed' ELSE 'failed' END;
  UPDATE public.provider_quota_reservations
  SET actual_units = 1,
      status = v_status,
      attempted_at = COALESCE(attempted_at, now()),
      completed_at = now(),
      error_code = CASE WHEN p_success THEN NULL ELSE COALESCE(p_error_code, 'provider_error') END,
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = v_reservation.id;

  INSERT INTO public.provider_usage_events(
    provider, operation, run_id, query_id, request_key, units,
    requests_count, items_count, success, error_code, occurred_at, metadata
  ) VALUES (
    'newsapi', 'everything', v_reservation.run_id, v_reservation.query_id,
    p_request_key, 1, 1, p_items_count, p_success,
    CASE WHEN p_success THEN NULL ELSE COALESCE(p_error_code, 'provider_error') END,
    v_reservation.occurred_at,
    v_reservation.metadata || COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'quota_reservation_id', v_reservation.id,
      'http_status', p_http_status,
      'measurement_quality', 'provider_attempt_observed'
    )
  )
  ON CONFLICT (provider, request_key) WHERE request_key IS NOT NULL
  DO UPDATE SET
    items_count = EXCLUDED.items_count,
    success = EXCLUDED.success,
    error_code = EXCLUDED.error_code,
    metadata = public.provider_usage_events.metadata || EXCLUDED.metadata
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.newsapi_quota_status(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_newsapi_request(text, uuid, uuid, integer, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_newsapi_request(text, integer, boolean, text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.newsapi_quota_status(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.newsapi_quota_status(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_newsapi_request(text, uuid, uuid, integer, timestamptz, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_newsapi_request(text, integer, boolean, text, integer, jsonb) TO service_role;

-- Les coûts sont figés au moment où un événement est valorisé. Changer un tarif
-- ne réécrit jamais l'histoire et une estimation ne devient pas un coût réel.
ALTER TABLE public.provider_usage_events
  ADD COLUMN IF NOT EXISTS applied_rate_id uuid REFERENCES public.provider_cost_rates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS effective_cost_amount numeric,
  ADD COLUMN IF NOT EXISTS effective_currency text,
  ADD COLUMN IF NOT EXISTS effective_cost_source text;

DO $$ BEGIN
  ALTER TABLE public.provider_usage_events
    ADD CONSTRAINT provider_usage_direct_cost_coherent CHECK (
      (cost_amount IS NULL AND currency IS NULL AND cost_source IS NULL)
      OR (
        cost_amount IS NOT NULL AND cost_amount >= 0
        AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$'
        AND cost_source IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.provider_usage_events
    ADD CONSTRAINT provider_usage_effective_cost_coherent CHECK (
      (effective_cost_amount IS NULL AND effective_currency IS NULL AND effective_cost_source IS NULL)
      OR (
        effective_cost_amount IS NOT NULL AND effective_cost_amount >= 0
        AND effective_currency IS NOT NULL AND effective_currency ~ '^[A-Z]{3}$'
        AND effective_cost_source IS NOT NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.freeze_provider_usage_cost()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rate public.provider_cost_rates%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Ce déclencheur n'est pas une porte de modification des coûts directs :
    -- une mise à jour d'unités conserve exactement leur preuve d'origine.
    NEW.cost_amount := OLD.cost_amount;
    NEW.currency := OLD.currency;
    NEW.cost_source := OLD.cost_source;

    -- Un coût direct (facture/API) ne dépend pas du nombre d'unités. Il reste
    -- donc figé même si le fournisseur livre les unités après l'appel.
    IF OLD.cost_amount IS NOT NULL THEN
      NEW.applied_rate_id := OLD.applied_rate_id;
      NEW.effective_cost_amount := OLD.effective_cost_amount;
      NEW.effective_currency := OLD.effective_currency;
      NEW.effective_cost_source := OLD.effective_cost_source;
      RETURN NEW;
    END IF;

    -- Une insertion avec units=0 représente une mesure encore en attente. Si
    -- elle avait déjà sélectionné son tarif, la première livraison des unités
    -- réutilise exactement ce tarif historique au lieu de consulter le tarif
    -- courant. Cela transforme le faux zéro initial en coût fiable une fois.
    IF OLD.units = 0
       AND OLD.applied_rate_id IS NOT NULL
       AND OLD.effective_cost_amount = 0 THEN
      IF NEW.units = 0 THEN
        NEW.applied_rate_id := NULL;
        NEW.effective_cost_amount := NULL;
        NEW.effective_currency := NULL;
        NEW.effective_cost_source := NULL;
        RETURN NEW;
      END IF;

      SELECT * INTO STRICT v_rate
      FROM public.provider_cost_rates
      WHERE id = OLD.applied_rate_id;

      NEW.applied_rate_id := OLD.applied_rate_id;
      NEW.effective_cost_amount := NEW.units * v_rate.unit_price;
      NEW.effective_currency := v_rate.currency;
      NEW.effective_cost_source := v_rate.source;
      RETURN NEW;
    END IF;

    -- Après valorisation par unité, les unités et le coût forment ensemble un
    -- historique immuable. Une correction doit devenir un nouvel événement,
    -- jamais recalculer silencieusement un événement finalisé.
    IF OLD.effective_cost_amount IS NOT NULL THEN
      IF NEW.units IS DISTINCT FROM OLD.units THEN
        RAISE EXCEPTION 'Les unités d un coût fournisseur finalisé sont immuables'
          USING ERRCODE = '55000';
      END IF;
      NEW.applied_rate_id := OLD.applied_rate_id;
      NEW.effective_cost_amount := OLD.effective_cost_amount;
      NEW.effective_currency := OLD.effective_currency;
      NEW.effective_cost_source := OLD.effective_cost_source;
      RETURN NEW;
    END IF;
  END IF;

  -- Ces colonnes sont toujours dérivées par ce déclencheur. Une insertion ou
  -- une finalisation non tarifée ne peut pas injecter sa propre valorisation.
  NEW.applied_rate_id := NULL;
  NEW.effective_cost_amount := NULL;
  NEW.effective_currency := NULL;
  NEW.effective_cost_source := NULL;

  IF NEW.cost_amount IS NOT NULL THEN
    NEW.effective_cost_amount := NEW.cost_amount;
    NEW.effective_currency := NEW.currency;
    NEW.effective_cost_source := NEW.cost_source;
    NEW.applied_rate_id := NULL;
    RETURN NEW;
  END IF;

  -- Zéro unité n'est pas un coût nul : pour les appels à tokens, c'est la
  -- valeur d'attente écrite avant que le fournisseur retourne son usage.
  IF NEW.units = 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rate
  FROM public.provider_cost_rates
  WHERE provider = NEW.provider
    AND operation = NEW.operation
    AND effective_from <= NEW.occurred_at
    AND (effective_to IS NULL OR effective_to > NEW.occurred_at)
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
  IF FOUND THEN
    NEW.applied_rate_id := v_rate.id;
    NEW.effective_cost_amount := NEW.units * v_rate.unit_price;
    NEW.effective_currency := v_rate.currency;
    NEW.effective_cost_source := v_rate.source;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_provider_usage_cost_before_insert ON public.provider_usage_events;
DROP TRIGGER IF EXISTS freeze_provider_usage_cost_before_write ON public.provider_usage_events;
CREATE TRIGGER freeze_provider_usage_cost_before_write
  BEFORE INSERT OR UPDATE OF units ON public.provider_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.freeze_provider_usage_cost();

CREATE OR REPLACE FUNCTION public.guard_provider_cost_rate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un tarif fournisseur est append-only; ajoutez une nouvelle période' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.provider IS DISTINCT FROM OLD.provider
       OR NEW.operation IS DISTINCT FROM OLD.operation
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.evidence IS DISTINCT FROM OLD.evidence
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.effective_to IS NULL
       OR NEW.effective_to <= OLD.effective_from
       OR (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to) THEN
      RAISE EXCEPTION 'Seule la clôture anticipée d une période tarifaire est autorisée'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:provider-rate:' || NEW.provider || ':' || NEW.operation, 0));
  IF EXISTS (
    SELECT 1 FROM public.provider_cost_rates existing
    WHERE existing.provider = NEW.provider
      AND existing.operation = NEW.operation
      AND tstzrange(existing.effective_from, existing.effective_to, '[)')
          && tstzrange(NEW.effective_from, NEW.effective_to, '[)')
  ) THEN
    RAISE EXCEPTION 'Période tarifaire chevauchante pour %/%', NEW.provider, NEW.operation USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_provider_cost_rate_changes ON public.provider_cost_rates;
CREATE TRIGGER guard_provider_cost_rate_changes
  BEFORE INSERT OR UPDATE OR DELETE ON public.provider_cost_rates
  FOR EACH ROW EXECUTE FUNCTION public.guard_provider_cost_rate();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.provider_cost_rates FROM authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.provider_cost_rates FROM service_role;
GRANT INSERT, SELECT ON public.provider_cost_rates TO service_role;

CREATE OR REPLACE FUNCTION public.add_provider_cost_rate(
  p_provider text,
  p_operation text,
  p_unit_price numeric,
  p_currency text,
  p_source text,
  p_effective_from timestamptz,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_previous public.provider_cost_rates%ROWTYPE;
  v_next_start timestamptz;
  v_id uuid;
BEGIN
  IF COALESCE(trim(p_provider), '') = ''
     OR COALESCE(trim(p_operation), '') = ''
     OR p_unit_price IS NULL OR p_unit_price < 0
     OR p_currency !~ '^[A-Z]{3}$'
     OR p_source NOT IN ('invoice', 'provider_api', 'configured_rate')
     OR p_effective_from IS NULL THEN
    RAISE EXCEPTION 'Tarif fournisseur invalide' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'gourrmet:provider-rate:' || p_provider || ':' || p_operation,
    0
  ));

  SELECT * INTO v_previous
  FROM public.provider_cost_rates
  WHERE provider = p_provider
    AND operation = p_operation
    AND effective_from < p_effective_from
    AND (effective_to IS NULL OR effective_to > p_effective_from)
  ORDER BY effective_from DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.provider_cost_rates
    SET effective_to = p_effective_from
    WHERE id = v_previous.id;
  END IF;

  SELECT min(effective_from) INTO v_next_start
  FROM public.provider_cost_rates
  WHERE provider = p_provider
    AND operation = p_operation
    AND effective_from > p_effective_from;

  INSERT INTO public.provider_cost_rates(
    provider, operation, unit_price, currency, source,
    effective_from, effective_to, evidence
  ) VALUES (
    p_provider, p_operation, p_unit_price, p_currency, p_source,
    p_effective_from, v_next_start, COALESCE(p_evidence, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.add_provider_cost_rate(
  text, text, numeric, text, text, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_provider_cost_rate(
  text, text, numeric, text, text, timestamptz, jsonb
) TO service_role;

-- Backfill unique au cutover : la valorisation obtenue est ensuite immuable.
UPDATE public.provider_usage_events event
SET effective_cost_amount = event.cost_amount,
    effective_currency = event.currency,
    effective_cost_source = event.cost_source
WHERE event.cost_amount IS NOT NULL
  AND event.effective_cost_amount IS NULL;

WITH matched_rate AS (
  SELECT event.id AS event_id, event.units, rate.id AS rate_id,
         rate.unit_price, rate.currency, rate.source
  FROM public.provider_usage_events event
  JOIN LATERAL (
    SELECT configured.*
    FROM public.provider_cost_rates configured
    WHERE configured.provider = event.provider
      AND configured.operation = event.operation
      AND configured.effective_from <= event.occurred_at
      AND (configured.effective_to IS NULL OR configured.effective_to > event.occurred_at)
    ORDER BY configured.effective_from DESC, configured.created_at DESC
    LIMIT 1
  ) rate ON true
  WHERE event.effective_cost_amount IS NULL
    AND event.units > 0
)
UPDATE public.provider_usage_events event
SET applied_rate_id = matched_rate.rate_id,
    effective_cost_amount = matched_rate.units * matched_rate.unit_price,
    effective_currency = matched_rate.currency,
    effective_cost_source = matched_rate.source
FROM matched_rate
WHERE event.id = matched_rate.event_id;

DROP VIEW IF EXISTS public.acquisition_run_cost_metrics;
DROP VIEW IF EXISTS public.provider_usage_daily_metrics;
DROP VIEW IF EXISTS public.provider_usage_costed;

CREATE VIEW public.provider_usage_costed
WITH (security_invoker = true)
AS
SELECT
  usage.*,
  (
    usage.effective_cost_amount IS NOT NULL
    AND usage.effective_currency IS NOT NULL
    AND usage.effective_cost_source IN ('invoice', 'provider_api', 'configured_rate')
  ) AS is_priced,
  (
    usage.effective_cost_amount IS NOT NULL
    AND usage.effective_currency IS NOT NULL
    AND usage.effective_cost_source = 'estimate'
  ) AS is_estimated
FROM public.provider_usage_events usage;

CREATE VIEW public.provider_usage_daily_metrics
WITH (security_invoker = true)
AS
SELECT
  occurred_at::date AS usage_date,
  provider,
  operation,
  count(*) AS event_count,
  count(*) FILTER (WHERE success) AS successful_event_count,
  sum(requests_count) AS request_count,
  sum(units) AS units,
  sum(items_count) AS items,
  count(*) FILTER (WHERE NOT is_priced) AS unpriced_event_count,
  CASE
    WHEN bool_and(is_priced) AND count(DISTINCT effective_currency) = 1
      THEN sum(effective_cost_amount)
    ELSE NULL
  END AS total_cost,
  CASE WHEN count(DISTINCT effective_currency) = 1 THEN min(effective_currency) ELSE NULL END AS currency,
  (bool_and(is_priced) AND count(DISTINCT effective_currency) = 1) AS fully_priced
FROM public.provider_usage_costed
GROUP BY occurred_at::date, provider, operation;

CREATE VIEW public.acquisition_run_cost_metrics
WITH (security_invoker = true)
AS
WITH runs AS (
  SELECT 'press'::text AS source, log.id AS run_id, log.status, log.started_at, log.completed_at,
         count(signal.id)::bigint AS signals_created
  FROM public.scan_logs log
  LEFT JOIN public.signals signal ON signal.detection_run_id = log.id
  GROUP BY log.id, log.status, log.started_at, log.completed_at
  UNION ALL
  SELECT 'pappers'::text, progress.id, progress.status,
         COALESCE(progress.started_at, progress.created_at), progress.completed_at,
         count(signal.id)::bigint
  FROM public.pappers_scan_progress progress
  LEFT JOIN public.pappers_signals signal ON signal.scan_id = progress.id
  GROUP BY progress.id, progress.status, progress.started_at, progress.created_at, progress.completed_at
), usage AS (
  SELECT run_id,
         count(*) AS provider_event_count,
         sum(requests_count) AS provider_request_count,
         sum(units) AS provider_units,
         count(*) FILTER (WHERE NOT is_priced) AS unpriced_event_count,
         (bool_and(is_priced) AND count(DISTINCT effective_currency) = 1) AS fully_priced,
         CASE
           WHEN bool_and(is_priced) AND count(DISTINCT effective_currency) = 1
             THEN sum(effective_cost_amount)
           ELSE NULL
         END AS total_cost,
         CASE WHEN count(DISTINCT effective_currency) = 1 THEN min(effective_currency) END AS currency
  FROM public.provider_usage_costed
  WHERE run_id IS NOT NULL
  GROUP BY run_id
)
SELECT runs.source, runs.run_id, runs.status, runs.started_at, runs.completed_at,
       runs.signals_created,
       COALESCE(usage.provider_event_count, 0) AS provider_event_count,
       COALESCE(usage.provider_request_count, 0) AS provider_request_count,
       COALESCE(usage.provider_units, 0) AS provider_units,
       COALESCE(usage.unpriced_event_count, 0) AS unpriced_event_count,
       COALESCE(usage.fully_priced, false) AS fully_priced,
       usage.total_cost, usage.currency,
       CASE
         WHEN usage.fully_priced AND runs.signals_created > 0
           THEN round(usage.total_cost / runs.signals_created, 6)
         ELSE NULL
       END AS cost_per_created_signal
FROM runs LEFT JOIN usage ON usage.run_id = runs.run_id;

COMMENT ON TABLE public.provider_quota_reservations IS
  'Autorité de quota. Une ligne reserved sans événement fournisseur est une capacité bloquée, pas un appel ni un coût mesuré.';
COMMENT ON TABLE public.provider_measurement_state IS
  'Début explicite de la mesure fiable par fournisseur; les taux antérieurs ne doivent pas être extrapolés.';
COMMENT ON VIEW public.provider_usage_costed IS
  'Coût figé à la valorisation. is_priced exclut les estimations et ne recalcule jamais l historique.';
REVOKE ALL ON public.provider_usage_costed FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.provider_usage_daily_metrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.acquisition_run_cost_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_usage_costed TO service_role;
GRANT SELECT ON public.provider_usage_daily_metrics TO service_role;
GRANT SELECT ON public.acquisition_run_cost_metrics TO service_role;

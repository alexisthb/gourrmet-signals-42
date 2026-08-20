-- Dropcontact v1 renvoie `credits_left` dans les payloads POST/GET. Cette
-- mesure conserve uniquement la valeur fournisseur effectivement observée :
-- aucune consommation ni aucun solde n'est reconstruit localement.

CREATE OR REPLACE FUNCTION public.register_dropcontact_balance_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.provider = 'dropcontact'
     AND NEW.metadata ? 'credits_left'
     AND NEW.metadata->>'balance_measurement_quality' IN ('provider_reported', 'not_observed') THEN
    INSERT INTO public.provider_measurement_state(provider, measurement_started_at, metadata)
    VALUES (
      'dropcontact',
      NEW.occurred_at,
      jsonb_build_object(
        'balance_field', 'credits_left',
        'balance_unit', 'credits',
        'balance_source', 'provider_api',
        'missing_value_policy', 'null'
      )
    )
    ON CONFLICT (provider) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.register_dropcontact_balance_measurement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS register_dropcontact_balance_measurement_after_insert
  ON public.provider_usage_events;
CREATE TRIGGER register_dropcontact_balance_measurement_after_insert
  AFTER INSERT ON public.provider_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.register_dropcontact_balance_measurement();

DROP VIEW IF EXISTS public.dropcontact_balance_metrics;
CREATE VIEW public.dropcontact_balance_metrics
WITH (security_invoker = true)
AS
WITH measured_calls AS (
  SELECT
    event.id,
    event.operation,
    event.success,
    event.error_code,
    event.requests_count,
    event.items_count,
    event.occurred_at,
    CASE
      WHEN jsonb_typeof(event.metadata->'credits_left') = 'number'
       AND event.metadata->>'credits_left' ~ '^[0-9]+$'
      THEN (event.metadata->>'credits_left')::numeric
      ELSE NULL
    END AS credits_left
  FROM public.provider_usage_events event
  WHERE event.provider = 'dropcontact'
    AND event.metadata ? 'credits_left'
    AND event.metadata->>'balance_measurement_quality' IN ('provider_reported', 'not_observed')
), latest_call AS (
  SELECT call.*
  FROM measured_calls call
  ORDER BY call.occurred_at DESC, call.id DESC
  LIMIT 1
), latest_balance AS (
  SELECT call.*
  FROM measured_calls call
  WHERE call.credits_left IS NOT NULL
  ORDER BY call.occurred_at DESC, call.id DESC
  LIMIT 1
), totals AS (
  SELECT
    min(occurred_at) AS measurement_started_at,
    count(*)::bigint AS event_count,
    count(*) FILTER (WHERE success)::bigint AS successful_event_count,
    count(*) FILTER (WHERE credits_left IS NOT NULL)::bigint AS balance_observation_count,
    COALESCE(sum(requests_count), 0)::bigint AS request_count,
    COALESCE(sum(items_count), 0)::bigint AS items_count
  FROM measured_calls
)
SELECT
  'dropcontact'::text AS provider,
  totals.measurement_started_at,
  latest_balance.credits_left,
  latest_balance.occurred_at AS balance_observed_at,
  latest_call.occurred_at AS latest_call_at,
  latest_call.operation AS latest_call_operation,
  latest_call.success AS latest_call_success,
  latest_call.error_code AS latest_call_error_code,
  (latest_call.credits_left IS NOT NULL) AS latest_call_reported_balance,
  CASE
    WHEN latest_balance.occurred_at IS NULL THEN NULL
    ELSE floor(extract(epoch FROM (now() - latest_balance.occurred_at)))::bigint
  END AS balance_age_seconds,
  CASE
    WHEN latest_call.occurred_at IS NULL THEN 'not_started'
    WHEN latest_call.credits_left IS NOT NULL THEN 'current'
    WHEN latest_balance.occurred_at IS NULL THEN 'unavailable'
    ELSE 'stale'
  END AS measurement_status,
  totals.event_count,
  totals.successful_event_count,
  totals.balance_observation_count,
  totals.request_count,
  totals.items_count
FROM totals
LEFT JOIN latest_call ON true
LEFT JOIN latest_balance ON true;

COMMENT ON VIEW public.dropcontact_balance_metrics IS
  'Dernier credits_left réellement observé dans un payload Dropcontact. stale/unavailable et NULL sont conservés; aucune consommation n est déduite des variations de solde.';

REVOKE ALL ON public.dropcontact_balance_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dropcontact_balance_metrics TO service_role;

CREATE OR REPLACE FUNCTION public.dropcontact_balance_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_status jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Compte interne requis' USING ERRCODE = '42501';
  END IF;

  SELECT to_jsonb(metrics) INTO v_status
  FROM public.dropcontact_balance_metrics metrics;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.dropcontact_balance_status()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dropcontact_balance_status()
  TO authenticated, service_role;

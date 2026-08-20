-- Apify expose `usageTotalUsd` sur la ressource run. Le poller ne fige ce coût
-- qu'après la fenêtre de cohérence éventuelle documentée par le fournisseur.
-- Les anciens événements restent hors cohorte : aucun coût historique n'est
-- reconstruit depuis une estimation ou le forfait affiché. La borne n'est
-- créée qu'au premier coût réellement observé, jamais au passage du DDL avant
-- que les nouvelles Edge Functions soient déployées.
CREATE OR REPLACE FUNCTION public.register_apify_cost_measurement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.provider = 'apify'
     AND NEW.operation = 'actor_run_cost'
     AND NEW.cost_source = 'provider_api'
     AND NEW.cost_amount IS NOT NULL
     AND NEW.currency = 'USD' THEN
    INSERT INTO public.provider_measurement_state(provider, measurement_started_at, metadata)
    VALUES (
      'apify',
      NEW.occurred_at,
      jsonb_build_object(
        'scope', 'actor_run_cost',
        'source', 'provider_api_usageTotalUsd',
        'excludes', jsonb_build_array('legacy_events', 'synchronous_company_search_without_run_id')
      )
    )
    ON CONFLICT (provider) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.register_apify_cost_measurement()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS register_apify_cost_measurement_after_insert
  ON public.provider_usage_events;
CREATE TRIGGER register_apify_cost_measurement_after_insert
  AFTER INSERT ON public.provider_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.register_apify_cost_measurement();

DROP FUNCTION IF EXISTS public.provider_signal_cost_status(uuid);
DROP VIEW IF EXISTS public.provider_signal_cost_metrics;
CREATE VIEW public.provider_signal_cost_metrics
WITH (security_invoker = true)
AS
SELECT
  signal_id,
  provider,
  count(*) AS event_count,
  sum(requests_count) AS request_count,
  sum(units) AS units,
  count(*) FILTER (WHERE is_priced) AS priced_event_count,
  count(*) FILTER (WHERE NOT is_priced) AS unpriced_event_count,
  CASE
    WHEN count(DISTINCT effective_currency) FILTER (WHERE is_priced) = 1
      THEN sum(effective_cost_amount) FILTER (WHERE is_priced)
    ELSE NULL
  END AS measured_cost,
  CASE
    WHEN count(DISTINCT effective_currency) FILTER (WHERE is_priced) = 1
      THEN min(effective_currency) FILTER (WHERE is_priced)
    ELSE NULL
  END AS measured_currency,
  (
    bool_and(is_priced)
    AND count(DISTINCT effective_currency) = 1
  ) AS fully_priced,
  CASE
    WHEN bool_and(is_priced) AND count(DISTINCT effective_currency) = 1
      THEN sum(effective_cost_amount)
    ELSE NULL
  END AS total_cost
FROM public.provider_usage_costed
WHERE signal_id IS NOT NULL
GROUP BY signal_id, provider;

COMMENT ON VIEW public.provider_signal_cost_metrics IS
  'Coût fournisseur par signal. measured_cost est la part prouvée; total_cost reste NULL tant qu un événement du signal est non tarifé.';

REVOKE ALL ON public.provider_signal_cost_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_signal_cost_metrics TO service_role;

CREATE OR REPLACE FUNCTION public.provider_signal_cost_status(
  p_signal_id uuid DEFAULT NULL
)
RETURNS TABLE (
  signal_id uuid,
  provider text,
  event_count bigint,
  request_count bigint,
  units numeric,
  priced_event_count bigint,
  unpriced_event_count bigint,
  measured_cost numeric,
  measured_currency text,
  fully_priced boolean,
  total_cost numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Compte interne requis' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    metrics.signal_id,
    metrics.provider,
    metrics.event_count,
    metrics.request_count,
    metrics.units,
    metrics.priced_event_count,
    metrics.unpriced_event_count,
    metrics.measured_cost,
    metrics.measured_currency,
    metrics.fully_priced,
    metrics.total_cost
  FROM public.provider_signal_cost_metrics AS metrics
  WHERE p_signal_id IS NULL OR metrics.signal_id = p_signal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_signal_cost_status(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_signal_cost_status(uuid)
  TO authenticated, service_role;
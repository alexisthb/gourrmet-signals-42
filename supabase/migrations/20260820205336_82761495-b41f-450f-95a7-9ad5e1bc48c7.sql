-- Ledger transversal : une ligne représente un appel fournisseur réellement effectué.
-- cost_amount reste NULL tant qu'aucun tarif/facture fiable n'a été configuré.
CREATE TABLE IF NOT EXISTS public.provider_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN (
    'newsapi', 'pappers', 'apify', 'dropcontact', 'perplexity', 'lovable_ai', 'lovable_email', 'resend'
  )),
  operation text NOT NULL,
  run_id uuid,
  query_id uuid,
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  request_key text,
  units numeric NOT NULL DEFAULT 0 CHECK (units >= 0),
  requests_count integer NOT NULL DEFAULT 1 CHECK (requests_count >= 0),
  items_count integer NOT NULL DEFAULT 0 CHECK (items_count >= 0),
  cost_amount numeric,
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  cost_source text CHECK (cost_source IS NULL OR cost_source IN ('invoice', 'provider_api', 'configured_rate', 'estimate')),
  success boolean NOT NULL DEFAULT true,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_usage_events_request_key_unique
  ON public.provider_usage_events(provider, request_key)
  WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_usage_events_provider_time
  ON public.provider_usage_events(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS provider_usage_events_run
  ON public.provider_usage_events(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_usage_events_signal
  ON public.provider_usage_events(signal_id) WHERE signal_id IS NOT NULL;

ALTER TABLE public.provider_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_usage_events_service_all ON public.provider_usage_events;
CREATE POLICY provider_usage_events_service_all ON public.provider_usage_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS provider_usage_events_admin_read ON public.provider_usage_events;
CREATE POLICY provider_usage_events_admin_read ON public.provider_usage_events
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );
REVOKE ALL ON public.provider_usage_events FROM anon;
GRANT SELECT ON public.provider_usage_events TO authenticated;
GRANT ALL ON public.provider_usage_events TO service_role;

-- Une seule exécution Pappers peut consommer des crédits à la fois. On clôt proprement
-- d'éventuels doublons historiques avant de poser l'invariant.
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS position
  FROM public.pappers_scan_progress
  WHERE status IN ('pending', 'running', 'paused')
)
UPDATE public.pappers_scan_progress p
SET status = 'error', completed_at = now(), error_message = 'Run concurrent clôturé par la migration de fiabilisation'
FROM ranked r
WHERE p.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS pappers_single_active_run
  ON public.pappers_scan_progress ((true))
  WHERE status IN ('pending', 'running', 'paused');

-- Les anciennes fonctions ne sont plus des moteurs concurrents : le seul cron Pappers doit
-- viser run-pappers-scan, qui délègue au moteur fetch-pappers avec un run contrôlable.
DO $$
DECLARE job record;
BEGIN
  FOR job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN ('daily-pappers-anniversary-scan', 'pappers-scan-every-12h')
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: scheduling Pappers à effectuer après activation';
END $$;

-- Aucun cron Pappers n'est activé pendant la migration : l'ancienne Edge peut
-- encore être servie. `configure_gourrmet_runtime_crons(true)` le planifie
-- explicitement après le cutover Edge (voir runbook).

-- Rétention bornée des traces opérationnelles. Les métriques agrégées fournisseur sont
-- conservées deux ans ; les réponses HTTP et détails cron, 30 et 90 jours.
CREATE OR REPLACE FUNCTION public.cleanup_operational_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  provider_deleted integer := 0;
  cron_deleted integer := 0;
  net_deleted integer := 0;
BEGIN
  DELETE FROM public.provider_usage_events WHERE occurred_at < now() - interval '2 years';
  GET DIAGNOSTICS provider_deleted = ROW_COUNT;
  BEGIN
    EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''90 days''';
    GET DIAGNOSTICS cron_deleted = ROW_COUNT;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
  BEGIN
    EXECUTE 'DELETE FROM net._http_response WHERE created < now() - interval ''30 days''';
    GET DIAGNOSTICS net_deleted = ROW_COUNT;
  EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
  END;
  RETURN jsonb_build_object(
    'provider_usage_events', provider_deleted,
    'cron_job_run_details', cron_deleted,
    'net_http_response', net_deleted
  );
END;
$$;
REVOKE ALL ON FUNCTION public.cleanup_operational_history() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_operational_history() TO service_role;

DO $$ BEGIN
  PERFORM cron.unschedule('cleanup-operational-history')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-operational-history');
  PERFORM cron.schedule(
    'cleanup-operational-history',
    '17 3 * * *',
    'SELECT public.cleanup_operational_history()'
  );
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: cleanup non planifié';
END $$;
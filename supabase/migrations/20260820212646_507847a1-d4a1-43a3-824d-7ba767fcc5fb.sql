-- Une intention est persistée avant chaque appel sans idempotence/récupération
-- fournisseur. Un process tué après le POST laisse ainsi une ambiguïté visible
-- et non valorisée, au lieu de fabriquer un coût nul ou de resoumettre.
ALTER TABLE public.provider_usage_events
  ADD COLUMN IF NOT EXISTS dispatch_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS business_key text;

DO $$ BEGIN
  ALTER TABLE public.provider_usage_events
    ADD CONSTRAINT provider_usage_dispatch_status_valid CHECK (
      dispatch_status IN ('unconfirmed', 'confirmed', 'reconciled_no_charge')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS provider_usage_dispatch_unconfirmed
  ON public.provider_usage_events(provider, operation, occurred_at)
  WHERE dispatch_status = 'unconfirmed';
CREATE INDEX IF NOT EXISTS provider_usage_unconfirmed_business_key
  ON public.provider_usage_events(provider, business_key)
  WHERE dispatch_status = 'unconfirmed' AND business_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS provider_usage_unconfirmed_metadata
  ON public.provider_usage_events USING gin(metadata jsonb_path_ops)
  WHERE dispatch_status = 'unconfirmed';
CREATE INDEX IF NOT EXISTS provider_quota_newsapi_business_metadata
  ON public.provider_quota_reservations USING gin(metadata jsonb_path_ops)
  WHERE provider = 'newsapi';

CREATE OR REPLACE VIEW public.provider_dispatch_uncertainty
WITH (security_invoker = true)
AS
SELECT
  id,
  provider,
  operation,
  business_key,
  run_id,
  signal_id,
  contact_id,
  request_key,
  occurred_at,
  error_code,
  metadata
FROM public.provider_usage_events
WHERE dispatch_status = 'unconfirmed';

COMMENT ON COLUMN public.provider_usage_events.dispatch_status IS
  'unconfirmed = intention durable sans résultat fournisseur prouvé; requests_count et units restent à 0 jusqu''à réconciliation.';
COMMENT ON COLUMN public.provider_usage_events.business_key IS
  'Identité métier stable utilisée pour retrouver une intention ambiguë entre deux runs ou invocations.';
COMMENT ON VIEW public.provider_dispatch_uncertainty IS
  'Appels potentiellement partis mais sans résultat récupérable; toute reprise automatique correspondante doit échouer fermée.';

REVOKE ALL ON public.provider_dispatch_uncertainty FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.provider_dispatch_uncertainty TO service_role;

-- Le tableau de bord doit lire exactement la même autorité que les workers.
-- Une erreur ne doit jamais être transformée en solde plein côté navigateur.
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
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Compte interne requis' USING ERRCODE = '42501';
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
  effective_limit := CASE
    WHEN period_current AND plan.monthly_credits > 0 THEN plan.monthly_credits
    ELSE 0
  END;

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

REVOKE ALL ON FUNCTION public.get_pappers_quota_status()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pappers_quota_status()
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.configure_gourrmet_runtime_crons(boolean);
CREATE OR REPLACE FUNCTION public.configure_gourrmet_runtime_crons(
  p_enable boolean DEFAULT false,
  p_domains text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  job record;
  removed_jobs integer := 0;
  scheduled_jobs integer := 0;
  allowed_domains constant text[] := ARRAY['email', 'enrichment', 'logos', 'press', 'pappers'];
  requested_domains text[] := COALESCE(p_domains, allowed_domains);
  requested_domain text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Accès service ou administrateur requis' USING ERRCODE = '42501';
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RETURN jsonb_build_object('status', 'not_scheduled', 'reason', 'pg_cron_unavailable');
  END IF;
  IF cardinality(requested_domains) = 0 THEN
    RAISE EXCEPTION 'Au moins un domaine cron est requis' USING ERRCODE = '22023';
  END IF;
  FOREACH requested_domain IN ARRAY requested_domains LOOP
    IF NOT requested_domain = ANY(allowed_domains) THEN
      RAISE EXCEPTION 'Domaine cron inconnu: %', requested_domain USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR job IN
    SELECT jobid FROM cron.job
    WHERE
      ('enrichment' = ANY(requested_domains) AND jobname IN (
        'enrichment-worker-tick', 'cron-check-linkedin-enrich-tick'
      )) OR
      ('logos' = ANY(requested_domains) AND jobname = 'auto-fetch-logos-tick') OR
      ('press' = ANY(requested_domains) AND jobname = 'scan-every-4-hours') OR
      ('email' = ANY(requested_domains) AND jobname = 'process-email-queue') OR
      ('pappers' = ANY(requested_domains) AND jobname IN (
        'daily-pappers-anniversary-scan', 'pappers-scan-every-12h'
      ))
  LOOP
    PERFORM cron.unschedule(job.jobid);
    removed_jobs := removed_jobs + 1;
  END LOOP;

  IF NOT coalesce(p_enable, false) THEN
    RETURN jsonb_build_object(
      'status', 'disabled', 'enabled', false, 'domains', requested_domains,
      'removed_jobs', removed_jobs
    );
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name IN ('service_role_key', 'email_queue_service_role_key')
      AND decrypted_secret <> ''
  ) THEN
    RETURN jsonb_build_object(
      'status', 'not_scheduled', 'reason', 'vault_service_role_key_missing',
      'enabled', false, 'removed_jobs', removed_jobs
    );
  END IF;
  IF to_regnamespace('net') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace ns ON ns.oid = proc.pronamespace
    WHERE ns.nspname = 'net' AND proc.proname = 'http_post'
  ) THEN
    RETURN jsonb_build_object(
      'status', 'not_scheduled', 'reason', 'pg_net_unavailable',
      'enabled', false, 'removed_jobs', removed_jobs
    );
  END IF;

  IF 'enrichment' = ANY(requested_domains) THEN
    PERFORM cron.schedule(
      'enrichment-worker-tick', '* * * * *',
      $job$SELECT net.http_post(
        url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/enrichment-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
          )
        ), body := '{}'::jsonb, timeout_milliseconds := 55000
      )$job$
    );
    PERFORM cron.schedule(
      'cron-check-linkedin-enrich-tick', '* * * * *',
      $job$SELECT net.http_post(
        url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-linkedin-enrich',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
          )
        ), body := '{}'::jsonb, timeout_milliseconds := 55000
      )$job$
    );
    scheduled_jobs := scheduled_jobs + 2;
  END IF;
  IF 'logos' = ANY(requested_domains) THEN
    PERFORM cron.schedule(
    'auto-fetch-logos-tick', '*/5 * * * *',
    $job$SELECT net.http_post(
      url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/fetch-company-logo',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
        )
      ),
      body := '{"batch":true,"minScore":4,"skipManus":true,"limit":10}'::jsonb,
      timeout_milliseconds := 55000
    )$job$
    );
    scheduled_jobs := scheduled_jobs + 1;
  END IF;
  IF 'press' = ANY(requested_domains) THEN
    PERFORM cron.schedule(
    'scan-every-4-hours', '0 */4 * * *',
    $job$SELECT net.http_post(
      url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/run-full-scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
        )
      ), body := '{}'::jsonb, timeout_milliseconds := 10000
    )$job$
    );
    scheduled_jobs := scheduled_jobs + 1;
  END IF;
  IF 'email' = ANY(requested_domains) THEN
    PERFORM cron.schedule(
    'process-email-queue', '10 seconds',
    $job$SELECT net.http_post(
      url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/process-email-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
        )
      ), body := '{}'::jsonb, timeout_milliseconds := 55000
    )$job$
    );
    scheduled_jobs := scheduled_jobs + 1;
  END IF;
  IF 'pappers' = ANY(requested_domains) THEN
    PERFORM cron.schedule(
    'pappers-scan-every-12h', '0 */12 * * *',
    $job$SELECT net.http_post(
      url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/run-pappers-scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
          NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
        )
      ), body := '{"action":"daily"}'::jsonb, timeout_milliseconds := 10000
    )$job$
    );
    scheduled_jobs := scheduled_jobs + 1;
  END IF;

  RETURN jsonb_build_object(
    'status', 'scheduled', 'enabled', true, 'domains', requested_domains,
    'scheduled_jobs', scheduled_jobs, 'removed_jobs', removed_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_gourrmet_runtime_crons(boolean, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_gourrmet_runtime_crons(boolean, text[])
  TO service_role;
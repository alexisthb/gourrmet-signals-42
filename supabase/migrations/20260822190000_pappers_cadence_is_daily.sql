-- LA CADENCE PAPPERS EST QUOTIDIENNE — PAR DÉCISION, PLUS PAR DÉRIVE.
--
-- Relevé à l'audit externe du 2026-08-22 : le dépôt encode un scan toutes les
-- 12 heures (`pappers-scan-every-12h`, '0 */12 * * *'), mais la production
-- exécute '0 2 * * *' — une fois par jour. Aucune décision consignée
-- n'expliquait l'écart. C'est le pire des états : le live a raison ou tort,
-- mais personne ne sait LEQUEL, et le prochain `configure_gourrmet_runtime_crons`
-- aurait silencieusement remis la cadence 12 h.
--
-- L'ARITHMÉTIQUE TRANCHE. Le plan Pappers accorde 500 crédits par période ;
-- au 22/08, la cadence QUOTIDIENNE en avait consommé 430,8 (~9/jour), laissant
-- 69,2 crédits pour tenir jusqu'au 29/08 — de justesse. Une cadence 12 h
-- doublerait la consommation vers ~18/jour : le quota serait épuisé en quatre
-- jours et la détection Pappers s'éteindrait AVANT la fin de période, en
-- silence. Contrairement au plafond Apify recalibré le même jour, ce quota-là
-- correspond à un abonnement réel : il ne se relève pas d'un UPDATE.
--
-- Le live avait donc raison. Cette migration fait du quotidien la cadence
-- OFFICIELLE, et renomme le job : un job nommé « every-12h » qui tourne une
-- fois par jour est un mensonge posé dans `cron.job`, et les mensonges
-- d'infrastructure finissent toujours par être crus par quelqu'un.
--
-- Toucher à la cadence redevient ainsi un choix qui se voit : elle vit dans
-- `configure_gourrmet_runtime_crons`, versionnée, avec ce commentaire.

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
      -- L'ancien nom reste dans la liste de retrait : une base qui porte
      -- encore `pappers-scan-every-12h` doit le perdre ici, pas le cumuler.
      ('pappers' = ANY(requested_domains) AND jobname IN (
        'daily-pappers-anniversary-scan', 'pappers-scan-every-12h', 'pappers-scan-daily'
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
    -- QUOTIDIEN, à 02:00 UTC. Le quota (500 crédits/période, ~9 consommés par
    -- scan quotidien) ne survit PAS à une cadence 12 h — voir l'en-tête.
    PERFORM cron.schedule(
    'pappers-scan-daily', '0 2 * * *',
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

-- ─────────────────────────────────────────────────────────────────────────────
-- L'état affiché à l'opératrice suit le renommage : la barre de synchro du
-- tableau de bord Pappers lit `cron_state` (via `cron_state_live`) par
-- job_name. Sans cette bascule, elle chercherait un job qui n'existe plus et
-- afficherait « inconnu » — un renommage qui casse l'affichage n'est pas un
-- renommage, c'est une panne cosmétique.

DELETE FROM public.cron_state
WHERE job_name = 'pappers-scan-every-12h'
  AND EXISTS (SELECT 1 FROM public.cron_state WHERE job_name = 'pappers-scan-daily');

UPDATE public.cron_state
SET job_name = 'pappers-scan-daily',
    schedule = '0 2 * * *',
    description = 'Scan Pappers quotidien (02:00 UTC) — cadence financable par le quota de 500 credits/periode',
    updated_at = now()
WHERE job_name = 'pappers-scan-every-12h';

-- ─────────────────────────────────────────────────────────────────────────────
-- Le job LIVE : renommé sans changer sa cadence réelle. `0 2 * * *` était déjà
-- ce qui tournait — seul le nom mentait.

DO $$
DECLARE
  v_schedule text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron indisponible : renommage du job Pappers non appliqué';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job
  WHERE jobname IN ('pappers-scan-every-12h', 'pappers-scan-daily');

  PERFORM cron.schedule(
    'pappers-scan-daily', '0 2 * * *',
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

  SELECT schedule INTO v_schedule FROM cron.job WHERE jobname = 'pappers-scan-daily';
  RAISE NOTICE 'Job Pappers replanifié : pappers-scan-daily @ %', v_schedule;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible : renommage du job Pappers non appliqué';
END $$;

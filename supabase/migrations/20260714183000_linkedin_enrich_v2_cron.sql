-- v2 enrichissement contacts — voie LinkedIn (acheteurs opérationnels).
--
-- Le dispatcher enrich-contacts-linkedin soumet une run Apify (company-employees) puis rend la
-- main. Ce cron appelle cron-check-linkedin-enrich chaque minute pour :
--   - récolter la run Apify terminée, filtrer les personas opérationnels,
--   - vérifier les emails via Dropcontact,
--   - écrire les contacts.
-- Même convention que cron-check-manus-tick (pas d'Authorization explicite ; la fonction est en
-- verify_jwt = false dans config.toml). Idempotent : on désschedule avant de rescheduler.

DO $$ BEGIN
  PERFORM cron.unschedule('cron-check-linkedin-enrich-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-check-linkedin-enrich-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'cron-check-linkedin-enrich-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-linkedin-enrich',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

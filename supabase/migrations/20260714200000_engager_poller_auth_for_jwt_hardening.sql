-- Durcissement sécurité (item 4) : ajout d'un header Authorization au cron
-- `engager-enrichment-poller`.
--
-- CONTEXTE : dans le même lot, config.toml bascule check-engager-enrichment de
-- verify_jwt = false -> true (plus aucune source anonyme tolérée). Or ce cron
-- appelait la fonction SANS header Authorization (cf 20260627001000). Sans ce
-- correctif, la fonction répondrait 401 à chaque tick une fois déployée, et les
-- contacts engagers resteraient bloqués en 'manus_processing' à vie (exactement
-- le bug "Manus en continu" que le poller devait fermer).
--
-- SOLUTION : on rescheduling le cron avec le JWT anon en Bearer (même convention
-- que scan-every-4-hours et pappers-scan-every-12h, déjà authentifiés en prod).
-- Le JWT anon suffit à passer la porte verify_jwt = true ; la fonction utilise de
-- toute façon son propre SUPABASE_SERVICE_ROLE_KEY en interne pour la BDD. Le JWT
-- anon est public par conception (embarqué dans le bundle front). Idempotent :
-- unschedule avant schedule.

DO $$
BEGIN
  PERFORM cron.unschedule('engager-enrichment-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engager-enrichment-poller');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'engager-enrichment-poller',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/check-engager-enrichment',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Z2h6ZnR4aHhsdmxpZWtxaWF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwNjA3MjEsImV4cCI6MjA4MTYzNjcyMX0.Q76NR8EKolvsi9YsAHn7Ti0Zk3sgfeWG16dFM8xSLs0"}'::jsonb,
    body := '{"batch": true}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

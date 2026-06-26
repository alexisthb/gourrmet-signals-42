-- Schedule cron-check-logos toutes les 2 minutes.
-- Corrige la cause racine des logos "Manus en cours" bloqués : il n'existait
-- aucun poller backend pour les logos (seul le frontend pollait). Même
-- convention que enrichment-worker-tick (cf. 20260517141000).

DO $$
BEGIN
  PERFORM cron.unschedule('cron-check-logos-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-check-logos-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-check-logos-tick',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-logos',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

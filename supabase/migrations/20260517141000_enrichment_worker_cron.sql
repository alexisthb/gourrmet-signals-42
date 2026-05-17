-- GR-010 — Cron qui declenche enrichment-worker toutes les minutes.
-- Le worker depile la queue enrichment_jobs et respecte MAX_ENRICHMENT_CONCURRENCY.

-- Recuperer l'URL du projet depuis la migration existante daily-pappers-cron pour reutiliser
-- la meme convention. Idealement passer par une vault, mais pg_cron reste limite sur ce point.

DO $$
BEGIN
  -- Drop ancien job si existe (pour permettre rerun de la migration)
  PERFORM cron.unschedule('enrichment-worker-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'enrichment-worker-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- NB : on garde la meme approche que les crons existants (pas d'Authorization explicite).
-- L'Edge Function enrichment-worker recoit le call via le webhook public et utilise
-- SUPABASE_SERVICE_ROLE_KEY cote serveur. Pour durcir, voir migration de hardening
-- a venir (sprint suivant) qui passera tous les crons en Authorization Bearer.
SELECT cron.schedule(
  'enrichment-worker-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/enrichment-worker',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

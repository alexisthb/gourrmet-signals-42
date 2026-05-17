-- Alignement de cron_state avec la realite pg_cron en production.
--
-- Contexte : le seed initial de la migration 20260517150000_cron_state.sql se
-- basait sur les noms/schedules de la migration 20260107120000_create_pappers_daily_cron.sql
-- (daily 5h et 6h UTC). Mais en pratique, l'equipe a manuellement reprogramme
-- les crons via pg_cron pour augmenter la frequence :
--
--   scan-every-4-hours      0 */4 * * *
--   pappers-scan-every-12h  0 */12 * * *
--   check-manus-enrichments */10 * * * * *
--   enrichment-worker-tick  * * * * *
--
-- On garde les crons reels intacts (ils refletent un vrai besoin metier) et on
-- aligne cron_state pour que la SyncStatusBar pointe sur les bons jobs.

DELETE FROM cron_state WHERE job_name IN ('daily-press-scan', 'daily-pappers-anniversary-scan');

INSERT INTO cron_state (job_name, schedule, description, next_run_at)
VALUES
  ('scan-every-4-hours', '0 */4 * * *',
   'Scan presse NewsAPI + analyse Claude (toutes les 4h)',
   date_trunc('hour', NOW()) + INTERVAL '4 hours' - (EXTRACT(hour FROM NOW())::int % 4) * INTERVAL '1 hour'),

  ('pappers-scan-every-12h', '0 */12 * * *',
   'Scan Pappers anniversaires + nominations + capital (toutes les 12h)',
   date_trunc('hour', NOW()) + INTERVAL '12 hours' - (EXTRACT(hour FROM NOW())::int % 12) * INTERVAL '1 hour'),

  ('check-manus-enrichments', '*/10 * * * * *',
   'Poll des taches Manus en cours (toutes les 10 secondes)',
   NOW() + INTERVAL '10 seconds')
ON CONFLICT (job_name) DO UPDATE
SET schedule = EXCLUDED.schedule,
    description = EXCLUDED.description,
    next_run_at = EXCLUDED.next_run_at;

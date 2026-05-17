-- GR-011 — Table cron_state pour exposer en UI la frequence et le dernier run des scans.
-- Chaque Edge Function de scan (run-full-scan, fetch-pappers, enrichment-worker) doit
-- updater sa ligne au debut et fin d'execution.

CREATE TABLE IF NOT EXISTS cron_state (
  job_name TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  description TEXT,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('running', 'completed', 'failed')),
  last_run_duration_ms INT,
  last_error TEXT,
  next_run_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cron_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_state_read_authenticated" ON cron_state;
CREATE POLICY "cron_state_read_authenticated" ON cron_state
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "cron_state_write_service" ON cron_state;
CREATE POLICY "cron_state_write_service" ON cron_state
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Seed des crons reellement actifs en production pg_cron.
-- Les noms et frequences refletent l'etat live (audit fait le 17 mai 2026) :
-- l'equipe a manuellement upgrade les frequences depuis la migration historique
-- 20260107120000_create_pappers_daily_cron.sql (daily) vers des intervalles plus
-- courts. On ne touche pas aux crons reels, on aligne juste cron_state.
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
   NOW() + INTERVAL '10 seconds'),
  ('enrichment-worker-tick', '* * * * *',
   'Worker de la queue d''enrichissement (chaque minute)',
   date_trunc('minute', NOW()) + INTERVAL '1 minute')
ON CONFLICT (job_name) DO UPDATE
SET schedule = EXCLUDED.schedule,
    description = EXCLUDED.description,
    next_run_at = EXCLUDED.next_run_at;

-- Helper pour les Edge Functions : marquer le debut d'un run.
CREATE OR REPLACE FUNCTION cron_state_run_start(p_job_name TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO cron_state (job_name, schedule, last_run_at, last_run_status, updated_at)
  VALUES (p_job_name, 'unknown', NOW(), 'running', NOW())
  ON CONFLICT (job_name) DO UPDATE
  SET last_run_at = NOW(),
      last_run_status = 'running',
      last_error = NULL,
      updated_at = NOW();
$$;

-- Helper : marquer la fin (success ou fail).
CREATE OR REPLACE FUNCTION cron_state_run_end(
  p_job_name TEXT,
  p_status TEXT,
  p_duration_ms INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE cron_state
  SET last_run_status = p_status,
      last_run_duration_ms = p_duration_ms,
      last_error = p_error,
      updated_at = NOW()
  WHERE job_name = p_job_name;
$$;

GRANT EXECUTE ON FUNCTION cron_state_run_start(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cron_state_run_end(TEXT, TEXT, INT, TEXT) TO service_role;

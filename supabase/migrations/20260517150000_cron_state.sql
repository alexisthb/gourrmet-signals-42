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

-- Seed des crons connus (lus depuis les migrations existantes)
INSERT INTO cron_state (job_name, schedule, description, next_run_at)
VALUES
  ('daily-press-scan', '0 6 * * *', 'Scan presse NewsAPI + analyse Claude (quotidien 7h Paris)',
   date_trunc('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day 6 hours'),
  ('daily-pappers-anniversary-scan', '0 5 * * *', 'Scan Pappers anniversaires (quotidien 6h Paris)',
   date_trunc('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day 5 hours'),
  ('enrichment-worker-tick', '* * * * *', 'Worker de la queue d''enrichissement (chaque minute)',
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

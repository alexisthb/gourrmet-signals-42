-- GR-010 — Queue de jobs d'enrichissement pour parallelisation Manus.
-- Permet de lancer plusieurs scans Manus en concurrent sans saturer l'API,
-- avec retry exponentiel et tracking par signal.

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('contacts', 'logo', 'company_info')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority INT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),

  -- Timing
  queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ,

  -- Retry
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,

  -- Resultat
  result JSONB,
  error_message TEXT,

  -- Manus link (optionnel : si l'API Manus retourne un task_id, on le stocke ici)
  external_task_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_signal_id ON enrichment_jobs(signal_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_pending_priority
  ON enrichment_jobs(priority DESC, queued_at ASC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_retry
  ON enrichment_jobs(next_retry_at)
  WHERE status = 'failed' AND next_retry_at IS NOT NULL;

ALTER TABLE enrichment_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enrichment_jobs_read_authenticated" ON enrichment_jobs;
CREATE POLICY "enrichment_jobs_read_authenticated" ON enrichment_jobs
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "enrichment_jobs_write_service" ON enrichment_jobs;
CREATE POLICY "enrichment_jobs_write_service" ON enrichment_jobs
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Helper trigger pour updated_at
CREATE OR REPLACE FUNCTION touch_enrichment_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enrichment_jobs_updated_at ON enrichment_jobs;
CREATE TRIGGER trg_enrichment_jobs_updated_at
  BEFORE UPDATE ON enrichment_jobs
  FOR EACH ROW
  EXECUTE FUNCTION touch_enrichment_jobs_updated_at();

-- Fonction de pull atomique : reserve un job 'pending' (SELECT FOR UPDATE SKIP LOCKED)
-- pour eviter que 2 workers prennent le meme job.
CREATE OR REPLACE FUNCTION dequeue_enrichment_job(p_worker_id TEXT DEFAULT NULL)
RETURNS enrichment_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  v_job enrichment_jobs;
BEGIN
  SELECT * INTO v_job
  FROM enrichment_jobs
  WHERE status = 'pending'
    AND (next_retry_at IS NULL OR next_retry_at <= NOW())
  ORDER BY priority DESC, queued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE enrichment_jobs
  SET status = 'running',
      started_at = NOW(),
      attempts = attempts + 1,
      updated_at = NOW()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE EXECUTE ON FUNCTION dequeue_enrichment_job(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dequeue_enrichment_job(TEXT) TO service_role;

-- Vue d'agregat pour l'UI : compteurs par statut
CREATE OR REPLACE VIEW enrichment_queue_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
  COUNT(*) FILTER (WHERE status = 'running') AS running,
  COUNT(*) FILTER (WHERE status = 'completed' AND finished_at > NOW() - INTERVAL '1 hour') AS completed_last_hour,
  COUNT(*) FILTER (WHERE status = 'failed' AND finished_at > NOW() - INTERVAL '1 hour') AS failed_last_hour,
  MAX(queued_at) FILTER (WHERE status = 'pending') AS oldest_pending
FROM enrichment_jobs;

GRANT SELECT ON enrichment_queue_stats TO authenticated, service_role;

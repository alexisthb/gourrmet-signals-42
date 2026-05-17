CREATE OR REPLACE FUNCTION cron_state_run_start(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cron_state
  SET last_run_at = NOW(),
      last_run_status = 'running',
      last_error = NULL,
      updated_at = NOW()
  WHERE job_name = p_job_name;

  IF NOT FOUND THEN
    RAISE WARNING 'cron_state_run_start: unknown job_name %, ignoring (add it to cron_state seed if legitimate)', p_job_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cron_state_run_end(
  p_job_name TEXT,
  p_status TEXT,
  p_duration_ms INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cron_state
  SET last_run_status = p_status,
      last_run_duration_ms = p_duration_ms,
      last_error = p_error,
      next_run_at = COALESCE(public.compute_next_cron_run(schedule, NOW()), next_run_at),
      updated_at = NOW()
  WHERE job_name = p_job_name;

  IF NOT FOUND THEN
    RAISE WARNING 'cron_state_run_end: unknown job_name %, ignoring', p_job_name;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION cron_state_run_start(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cron_state_run_end(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cron_state_run_start(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cron_state_run_end(TEXT, TEXT, INT, TEXT) TO service_role;

UPDATE cron_state
SET last_run_at = NOW(),
    last_run_status = 'completed',
    last_error = NULL,
    next_run_at = COALESCE(public.compute_next_cron_run(schedule, NOW()), next_run_at),
    updated_at = NOW()
WHERE job_name IN ('scan-every-4-hours', 'pappers-scan-every-12h')
  AND last_run_at IS NULL;
CREATE OR REPLACE FUNCTION public.cron_state_run_start(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.cron_state
  SET last_run_at = NOW(),
      last_run_status = 'running',
      last_error = NULL,
      updated_at = NOW()
  WHERE job_name = p_job_name;

  IF NOT FOUND THEN
    RAISE WARNING 'cron_state_run_start: job_name % not registered in cron_state, skipping', p_job_name;
  END IF;
END;
$$;

DELETE FROM public.cron_state
WHERE job_name IN ('daily-press-scan', 'daily-pappers-anniversary-scan')
  AND schedule = 'unknown';
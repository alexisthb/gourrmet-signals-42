CREATE OR REPLACE FUNCTION public.compute_next_cron_run(
  p_schedule TEXT,
  p_from TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  parts TEXT[];
  field_count INT;
  v_n INT;
  v_next TIMESTAMPTZ;
  v_hour INT;
  v_min INT;
BEGIN
  IF p_schedule IS NULL OR p_schedule = '' THEN
    RETURN NULL;
  END IF;
  parts := regexp_split_to_array(trim(p_schedule), '\s+');
  field_count := array_length(parts, 1);
  IF field_count = 6 AND parts[1] ~ '^\*/\d+$' THEN
    v_n := substring(parts[1] FROM 3)::int;
    RETURN p_from + (v_n || ' seconds')::interval;
  END IF;
  IF field_count = 5 THEN
    IF parts[1] = '*' AND parts[2] = '*' AND parts[3] = '*' AND parts[4] = '*' AND parts[5] = '*' THEN
      RETURN date_trunc('minute', p_from) + INTERVAL '1 minute';
    END IF;
    IF parts[1] ~ '^\*/\d+$' AND parts[2] = '*' THEN
      v_n := substring(parts[1] FROM 3)::int;
      v_next := date_trunc('minute', p_from) + INTERVAL '1 minute';
      WHILE EXTRACT(minute FROM v_next)::int % v_n <> 0 LOOP
        v_next := v_next + INTERVAL '1 minute';
      END LOOP;
      RETURN v_next;
    END IF;
    IF parts[1] = '0' AND parts[2] ~ '^\*/\d+$' THEN
      v_n := substring(parts[2] FROM 3)::int;
      v_next := date_trunc('hour', p_from) + INTERVAL '1 hour';
      WHILE EXTRACT(hour FROM v_next)::int % v_n <> 0 LOOP
        v_next := v_next + INTERVAL '1 hour';
      END LOOP;
      RETURN v_next;
    END IF;
    IF parts[1] ~ '^\d+$' AND parts[2] ~ '^\d+$' AND parts[3] = '*' AND parts[4] = '*' AND parts[5] = '*' THEN
      v_min := parts[1]::int;
      v_hour := parts[2]::int;
      v_next := date_trunc('day', p_from) + (v_hour || ' hours')::interval + (v_min || ' minutes')::interval;
      IF v_next <= p_from THEN
        v_next := v_next + INTERVAL '1 day';
      END IF;
      RETURN v_next;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_next_cron_run(TEXT, TIMESTAMPTZ) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cron_state_run_end(
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
      next_run_at = COALESCE(public.compute_next_cron_run(schedule, NOW()), next_run_at),
      updated_at = NOW()
  WHERE job_name = p_job_name;
$$;

CREATE OR REPLACE VIEW public.cron_state_live AS
SELECT
  cs.job_name,
  cs.schedule,
  cs.description,
  cs.last_run_at,
  cs.last_run_status,
  cs.last_run_duration_ms,
  cs.last_error,
  CASE
    WHEN cs.next_run_at IS NOT NULL AND cs.next_run_at > NOW() THEN cs.next_run_at
    ELSE public.compute_next_cron_run(cs.schedule, NOW())
  END AS next_run_at,
  cs.enabled,
  cs.updated_at
FROM public.cron_state cs;

GRANT SELECT ON public.cron_state_live TO authenticated, service_role;

UPDATE public.cron_state
SET next_run_at = public.compute_next_cron_run(schedule, NOW())
WHERE next_run_at IS NULL OR next_run_at <= NOW();
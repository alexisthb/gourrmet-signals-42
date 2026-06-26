CREATE OR REPLACE FUNCTION public.relaunch_failed_enrichments(
  p_dry_run   boolean DEFAULT true,
  p_days      int     DEFAULT 30,
  p_limit     int     DEFAULT 50,
  p_min_score int     DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids   uuid[];
  v_count int;
  v_jobs  int := 0;
  v_samples jsonb;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT s.id
    FROM signals s
    WHERE s.enrichment_status = 'failed'
      AND s.created_at >= now() - make_interval(days => GREATEST(p_days, 0))
      AND COALESCE(s.score, 0) >= p_min_score
    ORDER BY COALESCE(s.score, 0) DESC, s.created_at DESC
    LIMIT GREATEST(p_limit, 0)
  ) t;

  v_count := COALESCE(array_length(v_ids, 1), 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'company_name', company_name,
            'source_name',  source_name,
            'score',        score)), '[]'::jsonb)
  INTO v_samples
  FROM signals WHERE id = ANY(v_ids);

  IF p_dry_run OR v_count = 0 THEN
    RETURN jsonb_build_object(
      'dry_run', p_dry_run, 'days', p_days, 'limit', p_limit,
      'min_score', p_min_score, 'targeted', v_count, 'sample', v_samples
    );
  END IF;

  UPDATE enrichment_jobs
  SET status = 'cancelled', finished_at = now()
  WHERE signal_id = ANY(v_ids) AND job_type = 'contacts' AND status IN ('pending', 'running');

  UPDATE company_enrichment
  SET status = 'pending', error_message = NULL, updated_at = now()
  WHERE signal_id = ANY(v_ids);

  UPDATE signals SET enrichment_status = 'none' WHERE id = ANY(v_ids);

  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 6 FROM unnest(v_ids) AS s;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false, 'relaunched', v_count, 'jobs_enqueued', v_jobs, 'sample', v_samples
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.relaunch_failed_enrichments(boolean, int, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.relaunch_failed_enrichments(boolean, int, int, int)
  TO service_role;
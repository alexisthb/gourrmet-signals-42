CREATE OR REPLACE FUNCTION public.presse_purge_fake_contacts_and_relaunch(
  p_dry_run        boolean DEFAULT true,
  p_min_companies  int     DEFAULT 10,
  p_min_score      int     DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fake_names           text[];
  v_fake_name_count      int := 0;
  v_purge_count          int := 0;
  v_signals_lost_contacts uuid[];
  v_signals_stuck        uuid[];
  v_signals_to_relaunch  uuid[];
  v_jobs_cancelled       int := 0;
  v_enr_reset            int := 0;
  v_jobs_enqueued        int := 0;
  v_sample               jsonb;
BEGIN
  SELECT array_agg(full_name) INTO v_fake_names
  FROM (
    SELECT c.full_name
    FROM contacts c
    WHERE c.full_name IS NOT NULL AND c.full_name <> ''
    GROUP BY c.full_name
    HAVING COUNT(DISTINCT c.signal_id) >= p_min_companies
  ) t;
  v_fake_name_count := COALESCE(array_length(v_fake_names,1),0);

  SELECT COUNT(*) INTO v_purge_count
  FROM contacts WHERE full_name = ANY(v_fake_names);

  SELECT array_agg(DISTINCT c.signal_id) INTO v_signals_lost_contacts
  FROM contacts c JOIN signals s ON s.id = c.signal_id
  WHERE c.full_name = ANY(v_fake_names)
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND COALESCE(s.score,0) >= p_min_score;

  SELECT array_agg(s.id) INTO v_signals_stuck
  FROM signals s
  WHERE s.enrichment_status IN ('pending','processing','manus_processing')
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND COALESCE(s.score,0) >= p_min_score;

  SELECT array_agg(DISTINCT id) INTO v_signals_to_relaunch FROM (
    SELECT unnest(COALESCE(v_signals_lost_contacts, ARRAY[]::uuid[])) AS id
    UNION
    SELECT unnest(COALESCE(v_signals_stuck,         ARRAY[]::uuid[])) AS id
  ) u;

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_sample FROM (
    SELECT jsonb_build_object('full_name', full_name, 'nb_entreprises', nb) x
    FROM (
      SELECT c.full_name, COUNT(DISTINCT c.signal_id) AS nb
      FROM contacts c
      WHERE c.full_name = ANY(v_fake_names)
      GROUP BY c.full_name
      ORDER BY nb DESC
      LIMIT 30
    ) g
  ) y;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'min_companies', p_min_companies,
      'min_score', p_min_score,
      'fake_names_detected', v_fake_name_count,
      'contacts_to_purge', v_purge_count,
      'signals_lost_contacts', COALESCE(array_length(v_signals_lost_contacts,1),0),
      'signals_stuck_in_flight', COALESCE(array_length(v_signals_stuck,1),0),
      'signals_to_relaunch_total', COALESCE(array_length(v_signals_to_relaunch,1),0),
      'sample_fake_names', v_sample
    );
  END IF;

  DELETE FROM contacts WHERE full_name = ANY(v_fake_names);
  GET DIAGNOSTICS v_purge_count = ROW_COUNT;

  UPDATE enrichment_jobs
  SET status = 'cancelled', finished_at = now()
  WHERE signal_id = ANY(v_signals_to_relaunch)
    AND job_type = 'contacts'
    AND status IN ('pending','running');
  GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

  UPDATE company_enrichment
  SET status = 'pending', updated_at = now()
  WHERE signal_id = ANY(v_signals_to_relaunch) AND status <> 'completed';
  GET DIAGNOSTICS v_enr_reset = ROW_COUNT;

  UPDATE signals SET enrichment_status = 'none'
  WHERE id = ANY(v_signals_to_relaunch);

  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 7 FROM unnest(v_signals_to_relaunch) AS s;
  GET DIAGNOSTICS v_jobs_enqueued = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false,
    'min_companies', p_min_companies,
    'min_score', p_min_score,
    'fake_names_purged', v_fake_name_count,
    'contacts_deleted', v_purge_count,
    'signals_relaunched', COALESCE(array_length(v_signals_to_relaunch,1),0),
    'jobs_cancelled', v_jobs_cancelled,
    'enrichments_reset', v_enr_reset,
    'jobs_enqueued', v_jobs_enqueued,
    'sample_fake_names', v_sample
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presse_purge_fake_contacts_and_relaunch(boolean,int,int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.presse_purge_fake_contacts_and_relaunch(boolean,int,int)
  TO service_role;
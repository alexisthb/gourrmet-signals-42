DO $$
DECLARE v_ids uuid[]; v_n int;
BEGIN
  SELECT array_agg(s.id) INTO v_ids
  FROM signals s
  LEFT JOIN company_enrichment ce ON ce.signal_id = s.id
  WHERE s.created_at >= now() - interval '30 days'
    AND COALESCE(s.score,0) >= 4
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND (
      s.enrichment_status = 'none'
      OR (ce.status = 'completed' AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.signal_id = s.id))
    );
  v_n := COALESCE(array_length(v_ids,1),0);
  IF v_n = 0 THEN RAISE NOTICE 'Rien à enfiler'; RETURN; END IF;

  UPDATE enrichment_jobs SET status='cancelled', finished_at=now()
  WHERE signal_id = ANY(v_ids) AND job_type='contacts' AND status IN ('pending','running');

  UPDATE company_enrichment SET status='pending', error_message=NULL, updated_at=now()
  WHERE signal_id = ANY(v_ids) AND status <> 'pending';

  UPDATE signals SET enrichment_status='none' WHERE id = ANY(v_ids) AND enrichment_status <> 'none';

  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 6 FROM unnest(v_ids) AS s;

  RAISE NOTICE 'Enfilé % signaux pour enrichissement contacts', v_n;
END $$;
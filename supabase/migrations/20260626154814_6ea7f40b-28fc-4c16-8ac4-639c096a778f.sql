CREATE OR REPLACE FUNCTION public.presse_provenance_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH presse AS (
    SELECT
      s.id, s.company_name, s.signal_type, s.source_name, s.source_url,
      s.status, s.created_at,
      (s.source_url IS NOT NULL AND s.source_url <> ''
        AND EXISTS (SELECT 1 FROM raw_articles ra WHERE ra.url = s.source_url)) AS is_real,
      (s.source_url IS NULL OR s.source_url = '') AS no_url
    FROM signals s
    WHERE s.source_name IS DISTINCT FROM 'Pappers'
      AND s.source_name IS DISTINCT FROM 'LinkedIn'
      AND COALESCE(s.signal_type,'') NOT IN
          ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
  ),
  classified AS (
    SELECT *,
      CASE WHEN is_real THEN 'real'
           WHEN no_url  THEN 'fake_no_url'
           ELSE 'fake_url_unmatched' END AS bucket
    FROM presse
  )
  SELECT jsonb_build_object(
    'presse_total',         (SELECT COUNT(*) FROM classified),
    'real_scraped',         (SELECT COUNT(*) FROM classified WHERE bucket = 'real'),
    'fake_no_url',          (SELECT COUNT(*) FROM classified WHERE bucket = 'fake_no_url'),
    'fake_url_unmatched',   (SELECT COUNT(*) FROM classified WHERE bucket = 'fake_url_unmatched'),
    'fake_total',           (SELECT COUNT(*) FROM classified WHERE bucket <> 'real'),
    'ignored_total',        (SELECT COUNT(*) FROM classified WHERE status = 'ignored'),
    'ignored_and_fake',     (SELECT COUNT(*) FROM classified WHERE status = 'ignored' AND bucket <> 'real'),
    'ignored_but_real',     (SELECT COUNT(*) FROM classified WHERE status = 'ignored' AND bucket = 'real'),
    'fake_not_ignored',     (SELECT COUNT(*) FROM classified WHERE bucket <> 'real' AND status IS DISTINCT FROM 'ignored'),
    'contacts_on_fakes',    (SELECT COUNT(*) FROM contacts c JOIN classified cl ON cl.id = c.signal_id WHERE cl.bucket <> 'real'),
    'enrichments_on_fakes', (SELECT COUNT(*) FROM company_enrichment ce JOIN classified cl ON cl.id = ce.signal_id WHERE cl.bucket <> 'real'),
    'credit_rows_on_fakes', (SELECT COUNT(*) FROM manus_credit_usage mu JOIN classified cl ON cl.id = mu.signal_id WHERE cl.bucket <> 'real'),
    'sample_fakes', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'company_name', company_name, 'status', status, 'signal_type', signal_type,
          'source_name', source_name, 'source_url', source_url, 'bucket', bucket
        )
        FROM classified WHERE bucket <> 'real' ORDER BY created_at DESC LIMIT 30
      ) x
    ),
    'sample_ignored_but_real', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('company_name', company_name, 'signal_type', signal_type, 'source_name', source_name)
        FROM classified WHERE status = 'ignored' AND bucket = 'real' ORDER BY created_at DESC LIMIT 20
      ) x
    ),
    'sample_real', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('company_name', company_name, 'status', status, 'source_name', source_name)
        FROM classified WHERE bucket = 'real' ORDER BY created_at DESC LIMIT 10
      ) x
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.presse_wipe_unscraped(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_contacts int := 0;
  v_enr int := 0;
  v_jobs int := 0;
  v_deleted int := 0;
  v_credit_unlinked int := 0;
  v_samples jsonb;
BEGIN
  SELECT array_agg(s.id) INTO v_ids
  FROM signals s
  WHERE s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND NOT (
      s.source_url IS NOT NULL AND s.source_url <> ''
      AND EXISTS (SELECT 1 FROM raw_articles ra WHERE ra.url = s.source_url)
    );

  v_count := COALESCE(array_length(v_ids,1),0);

  SELECT COUNT(*) INTO v_contacts FROM contacts WHERE signal_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_enr FROM company_enrichment WHERE signal_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_jobs FROM enrichment_jobs WHERE signal_id = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_samples FROM (
    SELECT jsonb_build_object(
      'company_name', company_name, 'status', status,
      'source_name', source_name, 'source_url', source_url
    )
    FROM signals WHERE id = ANY(v_ids) ORDER BY created_at DESC LIMIT 30
  ) x;

  IF p_dry_run OR v_count = 0 THEN
    RETURN jsonb_build_object(
      'dry_run', p_dry_run,
      'fake_signals_targeted', v_count,
      'contacts_to_delete', v_contacts,
      'enrichments_to_delete', v_enr,
      'jobs_to_delete', v_jobs,
      'sample', v_samples
    );
  END IF;

  UPDATE manus_credit_usage SET signal_id = NULL WHERE signal_id = ANY(v_ids);
  GET DIAGNOSTICS v_credit_unlinked = ROW_COUNT;
  UPDATE apify_credit_usage SET signal_id = NULL WHERE signal_id = ANY(v_ids);

  DELETE FROM signals WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false,
    'fake_signals_deleted', v_deleted,
    'contacts_deleted_cascade', v_contacts,
    'enrichments_deleted_cascade', v_enr,
    'jobs_deleted_cascade', v_jobs,
    'credit_rows_unlinked', v_credit_unlinked,
    'sample', v_samples
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presse_provenance_report()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_wipe_unscraped(boolean)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.presse_provenance_report()        TO service_role;
GRANT  EXECUTE ON FUNCTION public.presse_wipe_unscraped(boolean)    TO service_role;
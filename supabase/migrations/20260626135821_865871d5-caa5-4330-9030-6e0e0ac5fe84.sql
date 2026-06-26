-- Migration PR #12 — Maintenance Presse + cron-check-logos + cron-check-manus
-- Combinaison des fichiers 20260619140000/141000/142000 du repo (PR mergée).

CREATE OR REPLACE FUNCTION public.presse_maintenance_report()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'contacts_stuck', (SELECT COUNT(*) FROM signals s WHERE COALESCE(s.is_seed,false)=false AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn' AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement') AND s.enrichment_status IN ('manus_processing','processing','pending')),
    'contacts_failed', (SELECT COUNT(*) FROM signals s WHERE COALESCE(s.is_seed,false)=false AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn' AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement') AND s.enrichment_status='failed'),
    'logos_stuck', (SELECT COUNT(*) FROM signals s WHERE COALESCE(s.is_seed,false)=false AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn' AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement') AND s.logo_manus_task_id IS NOT NULL AND s.company_logo_url IS NULL),
    'logos_missing', (SELECT COUNT(*) FROM signals s WHERE COALESCE(s.is_seed,false)=false AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn' AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement') AND s.logo_manus_task_id IS NULL AND s.company_logo_url IS NULL),
    'problemes', (SELECT COUNT(*) FROM signals s WHERE s.status='probleme' AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn' AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')),
    'mock_enrichments', (SELECT COUNT(*) FROM company_enrichment WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed=true),
    'mock_contacts', (SELECT COUNT(*) FROM contacts c WHERE c.is_seed=true OR c.enrichment_id IN (SELECT id FROM company_enrichment WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed=true))
  );
$$;

CREATE OR REPLACE FUNCTION public.presse_relaunch_contacts(p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_count int; v_jobs int := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM signals s
  WHERE COALESCE(s.is_seed,false)=false AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND s.enrichment_status IN ('manus_processing','processing','pending','failed');
  v_count := COALESCE(array_length(v_ids,1),0);
  IF p_dry_run OR v_count=0 THEN
    RETURN jsonb_build_object('dry_run',p_dry_run,'signals_targeted',v_count,'jobs_enqueued',0);
  END IF;
  UPDATE enrichment_jobs SET status='cancelled', finished_at=now() WHERE signal_id = ANY(v_ids) AND job_type='contacts' AND status IN ('pending','running');
  UPDATE company_enrichment SET status='pending', updated_at=now() WHERE signal_id = ANY(v_ids) AND status<>'completed';
  UPDATE signals SET enrichment_status='none' WHERE id = ANY(v_ids);
  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority) SELECT s,'contacts','pending',5 FROM unnest(v_ids) AS s;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;
  RETURN jsonb_build_object('dry_run',false,'signals_targeted',v_count,'jobs_enqueued',v_jobs);
END; $$;

CREATE OR REPLACE FUNCTION public.presse_resolve_problemes(p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[]; v_count int; v_jobs int := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM signals s
  WHERE s.status='probleme' AND s.source_name IS DISTINCT FROM 'Pappers' AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement');
  v_count := COALESCE(array_length(v_ids,1),0);
  IF p_dry_run OR v_count=0 THEN
    RETURN jsonb_build_object('dry_run',p_dry_run,'problemes_targeted',v_count,'signal_ids',to_jsonb(COALESCE(v_ids,ARRAY[]::uuid[])));
  END IF;
  UPDATE enrichment_jobs SET status='cancelled', finished_at=now() WHERE signal_id = ANY(v_ids) AND job_type='contacts' AND status IN ('pending','running');
  UPDATE company_enrichment SET status='pending', updated_at=now() WHERE signal_id = ANY(v_ids) AND status<>'completed';
  UPDATE signals SET enrichment_status='none', status='new' WHERE id = ANY(v_ids);
  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority) SELECT s,'contacts','pending',7 FROM unnest(v_ids) AS s;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;
  RETURN jsonb_build_object('dry_run',false,'problemes_targeted',v_count,'jobs_enqueued',v_jobs,'signal_ids',to_jsonb(v_ids));
END; $$;

CREATE OR REPLACE FUNCTION public.presse_wipe_mocks(p_dry_run boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_enr_ids uuid[]; v_signal_ids uuid[]; v_contacts_count int; v_enr_count int; v_deleted_contacts int := 0; v_deleted_enr int := 0;
BEGIN
  SELECT array_agg(id), array_agg(DISTINCT signal_id) INTO v_enr_ids, v_signal_ids
  FROM company_enrichment WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed=true;
  v_enr_count := COALESCE(array_length(v_enr_ids,1),0);
  SELECT COUNT(*) INTO v_contacts_count FROM contacts c
  WHERE c.is_seed=true OR (v_enr_ids IS NOT NULL AND c.enrichment_id = ANY(v_enr_ids));
  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run',true,'mock_contacts',v_contacts_count,'mock_enrichments',v_enr_count);
  END IF;
  DELETE FROM contacts c WHERE c.is_seed=true OR (v_enr_ids IS NOT NULL AND c.enrichment_id = ANY(v_enr_ids));
  GET DIAGNOSTICS v_deleted_contacts = ROW_COUNT;
  DELETE FROM company_enrichment WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed=true;
  GET DIAGNOSTICS v_deleted_enr = ROW_COUNT;
  IF v_signal_ids IS NOT NULL THEN
    UPDATE signals SET enrichment_status='none' WHERE id = ANY(v_signal_ids) AND enrichment_status<>'none';
  END IF;
  RETURN jsonb_build_object('dry_run',false,'deleted_contacts',v_deleted_contacts,'deleted_enrichments',v_deleted_enr,'signals_reset',COALESCE(array_length(v_signal_ids,1),0));
END; $$;

REVOKE EXECUTE ON FUNCTION public.presse_maintenance_report() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_relaunch_contacts(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_resolve_problemes(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_wipe_mocks(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presse_maintenance_report() TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_relaunch_contacts(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_resolve_problemes(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_wipe_mocks(boolean) TO service_role;

-- cron-check-logos toutes les 2 minutes
DO $$ BEGIN
  PERFORM cron.unschedule('cron-check-logos-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cron-check-logos-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cron-check-logos-tick','*/2 * * * *',$$
  SELECT net.http_post(url:='https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-logos',
    headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb, timeout_milliseconds:=55000);
$$);

-- cron-check-manus chaque minute
DO $$ BEGIN
  PERFORM cron.unschedule('cron-check-manus-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cron-check-manus-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('cron-check-manus-tick','* * * * *',$$
  SELECT net.http_post(url:='https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-manus',
    headers:='{"Content-Type":"application/json"}'::jsonb, body:='{}'::jsonb, timeout_milliseconds:=55000);
$$);
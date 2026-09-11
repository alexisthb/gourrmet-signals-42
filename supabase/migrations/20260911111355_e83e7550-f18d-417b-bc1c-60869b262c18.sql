CREATE OR REPLACE FUNCTION public.update_enrichment_dispatch(p_job_id uuid, p_lease_token uuid, p_enrichment_id uuid, p_company_patch jsonb, p_signal_status text DEFAULT NULL::text, p_expected_status text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_signal_id uuid;
  v_updated integer;
BEGIN
  IF jsonb_typeof(COALESCE(p_company_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'company_patch doit être un objet JSON' USING ERRCODE = '22023';
  END IF;
  IF p_signal_status IS NOT NULL
     AND p_signal_status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'statut signal invalide: %', p_signal_status
      USING ERRCODE = '22023';
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.company_enrichment
  SET status = CASE
        WHEN p_company_patch ? 'status' THEN p_company_patch ->> 'status'
        ELSE status
      END,
      enrichment_source = CASE
        WHEN p_company_patch ? 'enrichment_source'
          THEN p_company_patch ->> 'enrichment_source'
        ELSE enrichment_source
      END,
      website = CASE
        WHEN p_company_patch ? 'website' THEN p_company_patch ->> 'website'
        ELSE website
      END,
      industry = CASE
        WHEN p_company_patch ? 'industry' THEN p_company_patch ->> 'industry'
        ELSE industry
      END,
      headquarters_location = CASE
        WHEN p_company_patch ? 'headquarters_location'
          THEN NULLIF(left(p_company_patch ->> 'headquarters_location', 200), '')
        ELSE headquarters_location
      END,
      linkedin_company_url = CASE
        WHEN p_company_patch ? 'linkedin_company_url'
          THEN p_company_patch ->> 'linkedin_company_url'
        ELSE linkedin_company_url
      END,
      error_message = CASE
        WHEN p_company_patch ? 'error_message'
          THEN NULLIF(left(p_company_patch ->> 'error_message', 300), '')
        ELSE error_message
      END,
      resolution_status = CASE
        WHEN p_company_patch ? 'resolution_status'
          THEN p_company_patch ->> 'resolution_status'
        ELSE resolution_status
      END,
      resolution_score = CASE
        WHEN p_company_patch ? 'resolution_score'
          THEN (p_company_patch ->> 'resolution_score')::numeric
        ELSE resolution_score
      END,
      resolution_provenance = CASE
        WHEN p_company_patch ? 'resolution_provenance'
          THEN p_company_patch -> 'resolution_provenance'
        ELSE resolution_provenance
      END,
      resolution_attempted_at = CASE
        WHEN p_company_patch ? 'resolution_attempted_at'
          THEN (p_company_patch ->> 'resolution_attempted_at')::timestamptz
        ELSE resolution_attempted_at
      END,
      resolution_technical_status = CASE
        WHEN p_company_patch ? 'resolution_technical_status'
          THEN p_company_patch ->> 'resolution_technical_status'
        ELSE resolution_technical_status
      END,
      operational_profiles_count = CASE
        WHEN p_company_patch ? 'operational_profiles_count'
          THEN (p_company_patch ->> 'operational_profiles_count')::integer
        ELSE operational_profiles_count
      END,
      contact_resolution_measured_at = CASE
        WHEN p_company_patch ? 'contact_resolution_measured_at'
          THEN (p_company_patch ->> 'contact_resolution_measured_at')::timestamptz
        ELSE contact_resolution_measured_at
      END,
      contact_candidates_resolved = CASE
        WHEN p_company_patch ? 'contact_candidates_resolved'
          THEN (p_company_patch ->> 'contact_candidates_resolved')::integer
        ELSE contact_candidates_resolved
      END,
      contact_candidates_ambiguous = CASE
        WHEN p_company_patch ? 'contact_candidates_ambiguous'
          THEN (p_company_patch ->> 'contact_candidates_ambiguous')::integer
        ELSE contact_candidates_ambiguous
      END,
      contact_candidates_rejected = CASE
        WHEN p_company_patch ? 'contact_candidates_rejected'
          THEN (p_company_patch ->> 'contact_candidates_rejected')::integer
        ELSE contact_candidates_rejected
      END,
      raw_data = CASE
        WHEN p_company_patch ? 'raw_data' THEN p_company_patch -> 'raw_data'
        ELSE raw_data
      END
  WHERE id = p_enrichment_id
    AND signal_id = v_signal_id
    AND (p_expected_status IS NULL OR status = p_expected_status);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN false; END IF;

  IF p_signal_status IS NOT NULL THEN
    UPDATE public.signals
    SET enrichment_status = p_signal_status
    WHERE id = v_signal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'signal introuvable pour mutation dispatcher'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN true;
END;
$function$;
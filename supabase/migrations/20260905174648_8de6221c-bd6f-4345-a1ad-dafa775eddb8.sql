CREATE OR REPLACE FUNCTION public.sync_tonal_charter_feedback_state(p_threshold integer DEFAULT 5)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  total_count integer := 0;
  pending_count integer := 0;
  last_cohort uuid[];
  affected integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF p_threshold IS NULL OR p_threshold < 1 THEN
    RAISE EXCEPTION 'Seuil de feedback invalide' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO total_count FROM public.message_feedback;
  SELECT feedback_ids INTO last_cohort
  FROM public.tonal_charter_analysis_runs
  WHERE status = 'completed'
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 1;
  SELECT count(*) INTO pending_count
  FROM public.message_feedback
  WHERE last_cohort IS NULL OR NOT (id = ANY(last_cohort));

  -- La garde safe-update de la base refuse tout UPDATE sans WHERE :
  -- la clause cible explicitement la (les) ligne(s) de la charte.
  UPDATE public.tonal_charter
  SET corrections_count = total_count,
      updated_at = now()
  WHERE id IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Aucune charte tonale à mettre à jour' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'total_corrections', total_count,
    'pending_since_last_analysis', pending_count,
    'threshold', p_threshold,
    'should_update_charter', pending_count >= p_threshold
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_tonal_charter_analysis(p_run_id uuid, p_lease_token uuid, p_charter_data jsonb, p_feedback_available integer, p_confidence_score numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  analysis public.tonal_charter_analysis_runs%ROWTYPE;
  ledger_confirmed boolean := false;
  affected integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF p_charter_data IS NULL OR jsonb_typeof(p_charter_data) <> 'object'
     OR p_feedback_available < 1
     OR p_confidence_score < 0 OR p_confidence_score > 1 THEN
    RAISE EXCEPTION 'Résultat de charte invalide' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO analysis
  FROM public.tonal_charter_analysis_runs
  WHERE id = p_run_id AND lease_token = p_lease_token
    AND status = 'response_cached' AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'lease_lost');
  END IF;

  IF analysis.provider_request_key IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'missing_provider_request_key');
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.provider_usage_events
    WHERE provider = 'lovable_ai'
      AND request_key = analysis.provider_request_key
      AND dispatch_status = 'confirmed'
  ) INTO ledger_confirmed;
  IF NOT ledger_confirmed THEN
    RETURN jsonb_build_object(
      'applied', false, 'reason', 'ledger_unconfirmed',
      'provider_request_key', analysis.provider_request_key
    );
  END IF;

  UPDATE public.tonal_charter
  SET charter_data = p_charter_data,
      corrections_count = p_feedback_available,
      last_analysis_at = now(),
      confidence_score = p_confidence_score,
      updated_at = now()
  WHERE id IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Aucune charte tonale à mettre à jour' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.tonal_charter_analysis_runs
  SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
      completed_at = now(), error_message = NULL, updated_at = now()
  WHERE id = analysis.id;
  RETURN jsonb_build_object('applied', true, 'reason', 'completed');
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_tonal_charter()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  abandoned_count integer := 0;
  reconciliation_count integer := 0;
  deleted_feedbacks integer := 0;
  affected integer := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;

  UPDATE public.tonal_charter_analysis_runs
  SET status = 'abandoned', lease_token = NULL, lease_expires_at = NULL,
      error_message = 'charter_reset_before_dispatch',
      updated_at = now()
  WHERE status = 'reserved';
  GET DIAGNOSTICS abandoned_count = ROW_COUNT;

  UPDATE public.tonal_charter_analysis_runs
  SET status = 'reconciliation_required', lease_token = NULL,
      lease_expires_at = NULL,
      error_message = 'charter_reset_with_provider_dispatch_in_flight',
      updated_at = now()
  WHERE status IN ('dispatching', 'response_cached');
  GET DIAGNOSTICS reconciliation_count = ROW_COUNT;

  DELETE FROM public.message_feedback WHERE id IS NOT NULL;
  GET DIAGNOSTICS deleted_feedbacks = ROW_COUNT;

  UPDATE public.tonal_charter
  SET charter_data = jsonb_build_object(
        'formality', jsonb_build_object(
          'level', 'neutre', 'tutoyment', false, 'observations', '[]'::jsonb),
        'structure', jsonb_build_object(
          'max_paragraphs', 3, 'sentence_length', 'moyenne',
          'observations', '[]'::jsonb),
        'vocabulary', jsonb_build_object(
          'forbidden_words', '[]'::jsonb, 'preferred_words', '[]'::jsonb,
          'observations', '[]'::jsonb),
        'tone', jsonb_build_object(
          'style', 'professionnel', 'humor_allowed', false,
          'observations', '[]'::jsonb),
        'signatures', jsonb_build_object(
          'preferred', '[]'::jsonb, 'avoided', '[]'::jsonb),
        'openings', jsonb_build_object(
          'preferred', '[]'::jsonb, 'avoided', '[]'::jsonb)
      ),
      corrections_count = 0,
      last_analysis_at = NULL,
      confidence_score = 0,
      updated_at = now()
  WHERE id IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Aucune charte tonale à réinitialiser' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'deleted_feedbacks', deleted_feedbacks,
    'abandoned_runs', abandoned_count,
    'reconciliation_required_runs', reconciliation_count
  );
END;
$function$;
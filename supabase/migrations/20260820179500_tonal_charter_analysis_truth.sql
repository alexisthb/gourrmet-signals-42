-- Une cohorte de feedback ne doit déclencher qu'une seule analyse automatique.
-- La réponse fournisseur est mise en cache avant l'écriture de la charte afin
-- qu'un kill/retry rejoue la persistance, jamais le POST payant.
CREATE TABLE IF NOT EXISTS public.tonal_charter_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key text NOT NULL UNIQUE,
  model text NOT NULL,
  feedback_ids uuid[] NOT NULL,
  feedback_count integer NOT NULL CHECK (feedback_count > 0),
  feedback_available integer NOT NULL CHECK (feedback_available >= feedback_count),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status text NOT NULL CHECK (
    status IN (
      'dispatching', 'response_cached', 'completed', 'failed',
      'reconciliation_required', 'abandoned'
    )
  ),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_request_key text,
  response_payload jsonb,
  error_message text,
  reconciliation jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  response_cached_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tonal_charter_analysis_status_idx
  ON public.tonal_charter_analysis_runs(status, updated_at DESC);

ALTER TABLE public.tonal_charter_analysis_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tonal_charter_analysis_service_all
  ON public.tonal_charter_analysis_runs;
CREATE POLICY tonal_charter_analysis_service_all
  ON public.tonal_charter_analysis_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.tonal_charter_analysis_runs
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tonal_charter_analysis_runs TO service_role;

CREATE OR REPLACE FUNCTION public.claim_tonal_charter_analysis(
  p_cohort_key text,
  p_model text,
  p_feedback_ids uuid[],
  p_feedback_available integer,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  analysis public.tonal_charter_analysis_runs%ROWTYPE;
  new_token uuid := gen_random_uuid();
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF p_cohort_key IS NULL OR length(btrim(p_cohort_key)) < 16
     OR p_model IS NULL OR btrim(p_model) = ''
     OR coalesce(cardinality(p_feedback_ids), 0) = 0
     OR p_feedback_available < cardinality(p_feedback_ids)
     OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Paramètres de cohorte tonale invalides' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('tonal:' || p_cohort_key, 0));
  SELECT * INTO analysis
  FROM public.tonal_charter_analysis_runs
  WHERE cohort_key = p_cohort_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.tonal_charter_analysis_runs (
      cohort_key, model, feedback_ids, feedback_count, feedback_available,
      attempt, status, lease_token, lease_expires_at
    ) VALUES (
      p_cohort_key, p_model, p_feedback_ids, cardinality(p_feedback_ids),
      p_feedback_available, 1, 'dispatching', new_token,
      now() + make_interval(secs => p_lease_seconds)
    ) RETURNING * INTO analysis;
    RETURN jsonb_build_object(
      'state', analysis.status, 'run_id', analysis.id,
      'lease_token', new_token, 'attempt', analysis.attempt,
      'should_dispatch', true, 'should_apply', false
    );
  END IF;

  IF analysis.model <> p_model OR analysis.feedback_ids <> p_feedback_ids THEN
    RAISE EXCEPTION 'La clé de cohorte ne correspond pas à son contenu'
      USING ERRCODE = '22000';
  END IF;
  IF analysis.status = 'completed' THEN
    RETURN jsonb_build_object(
      'state', analysis.status, 'run_id', analysis.id,
      'attempt', analysis.attempt, 'should_dispatch', false,
      'should_apply', false
    );
  END IF;
  IF analysis.status = 'response_cached' THEN
    UPDATE public.tonal_charter_analysis_runs
    SET lease_token = new_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    WHERE id = analysis.id
    RETURNING * INTO analysis;
    RETURN jsonb_build_object(
      'state', analysis.status, 'run_id', analysis.id,
      'lease_token', new_token, 'attempt', analysis.attempt,
      'provider_request_key', analysis.provider_request_key,
      'response_payload', analysis.response_payload,
      'should_dispatch', false, 'should_apply', true
    );
  END IF;
  IF analysis.status = 'dispatching' THEN
    IF analysis.lease_expires_at IS NOT NULL AND analysis.lease_expires_at > now() THEN
      RETURN jsonb_build_object(
        'state', 'active', 'run_id', analysis.id,
        'attempt', analysis.attempt, 'should_dispatch', false,
        'should_apply', false
      );
    END IF;
    UPDATE public.tonal_charter_analysis_runs
    SET status = 'reconciliation_required', lease_token = NULL,
        lease_expires_at = NULL,
        error_message = 'dispatch_expired_without_cached_response',
        updated_at = now()
    WHERE id = analysis.id;
    RETURN jsonb_build_object(
      'state', 'reconciliation_required', 'run_id', analysis.id,
      'attempt', analysis.attempt, 'should_dispatch', false,
      'should_apply', false
    );
  END IF;
  IF analysis.status IN ('reconciliation_required', 'abandoned') THEN
    RETURN jsonb_build_object(
      'state', analysis.status, 'run_id', analysis.id,
      'attempt', analysis.attempt, 'should_dispatch', false,
      'should_apply', false
    );
  END IF;

  -- Un échec terminal connu peut recevoir une nouvelle tentative. Une
  -- ambiguïté, elle, n'atteint jamais cet état sans arbitrage explicite.
  UPDATE public.tonal_charter_analysis_runs
  SET status = 'dispatching', attempt = attempt + 1,
      lease_token = new_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      provider_request_key = NULL, response_payload = NULL,
      response_cached_at = NULL, error_message = NULL,
      started_at = now(), completed_at = NULL, updated_at = now()
  WHERE id = analysis.id
  RETURNING * INTO analysis;

  RETURN jsonb_build_object(
    'state', analysis.status, 'run_id', analysis.id,
    'lease_token', new_token, 'attempt', analysis.attempt,
    'should_dispatch', true, 'should_apply', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cache_tonal_charter_analysis_response(
  p_run_id uuid,
  p_lease_token uuid,
  p_provider_request_key text,
  p_response_payload jsonb,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF p_provider_request_key IS NULL OR btrim(p_provider_request_key) = ''
     OR p_response_payload IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Réponse tonale invalide' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tonal_charter_analysis_runs
  SET status = 'response_cached',
      provider_request_key = p_provider_request_key,
      response_payload = p_response_payload,
      response_cached_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status = 'dispatching'
    AND lease_expires_at > now();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_tonal_charter_analysis(
  p_run_id uuid,
  p_lease_token uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tonal_charter_analysis_runs
  SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
      error_message = left(coalesce(nullif(p_error, ''), 'unknown_error'), 1000),
      updated_at = now()
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status IN ('dispatching', 'response_cached');
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_tonal_charter_analysis(
  p_run_id uuid,
  p_lease_token uuid,
  p_charter_data jsonb,
  p_feedback_available integer,
  p_confidence_score numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  analysis public.tonal_charter_analysis_runs%ROWTYPE;
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
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.tonal_charter
  SET charter_data = p_charter_data,
      corrections_count = p_feedback_available,
      last_analysis_at = now(),
      confidence_score = p_confidence_score,
      updated_at = now();
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected = 0 THEN
    RAISE EXCEPTION 'Aucune charte tonale à mettre à jour' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.tonal_charter_analysis_runs
  SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
      completed_at = now(), error_message = NULL, updated_at = now()
  WHERE id = analysis.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tonal_charter_analysis(text,text,uuid[],integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cache_tonal_charter_analysis_response(uuid,uuid,text,jsonb,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tonal_charter_analysis(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tonal_charter_analysis(uuid,uuid,jsonb,integer,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tonal_charter_analysis(text,text,uuid[],integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cache_tonal_charter_analysis_response(uuid,uuid,text,jsonb,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tonal_charter_analysis(uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tonal_charter_analysis(uuid,uuid,jsonb,integer,numeric)
  TO service_role;

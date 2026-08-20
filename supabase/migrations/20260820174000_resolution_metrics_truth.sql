-- Sépare disponibilité technique, résolution métier et obtention d'un profil
-- réellement exploitable. Les lignes historiques sans attempted_at restent
-- hors dénominateur plutôt que de fabriquer un taux optimiste.
ALTER TABLE public.company_enrichment
  ADD COLUMN IF NOT EXISTS resolution_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_technical_status text,
  ADD COLUMN IF NOT EXISTS operational_profiles_count integer NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE public.company_enrichment
    ADD CONSTRAINT company_enrichment_resolution_technical_status_check
    CHECK (resolution_technical_status IS NULL OR resolution_technical_status IN ('completed', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.company_enrichment
    ADD CONSTRAINT company_enrichment_operational_profiles_count_check
    CHECK (operational_profiles_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.resolution_quality_reviews
  ADD COLUMN IF NOT EXISTS prediction_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS dataset_version text,
  ADD COLUMN IF NOT EXISTS sampling_method text;

DO $$ BEGIN
  ALTER TABLE public.resolution_quality_reviews
    ADD CONSTRAINT resolution_review_sampling_method_check
    CHECK (sampling_method IS NULL OR sampling_method IN ('random', 'stratified', 'exhaustive', 'ad_hoc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.snapshot_resolution_quality_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF COALESCE(trim(NEW.dataset_version), '') = '' OR NEW.sampling_method IS NULL THEN
    RAISE EXCEPTION 'dataset_version et sampling_method sont obligatoires' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.prediction_snapshot := OLD.prediction_snapshot;
    RETURN NEW;
  END IF;
  IF NEW.subject_type = 'company' THEN
    SELECT jsonb_build_object(
      'resolution_status', resolution_status,
      'resolution_score', resolution_score,
      'resolution_provenance', resolution_provenance,
      'technical_status', resolution_technical_status,
      'attempted_at', resolution_attempted_at
    ) INTO v_snapshot
    FROM public.company_enrichment WHERE id = NEW.company_enrichment_id;
  ELSE
    SELECT jsonb_build_object(
      'resolution_status', resolution_status,
      'resolution_score', resolution_score,
      'resolution_provenance', resolution_provenance,
      'email_verification_status', email_verification_status,
      'email_verification_provider', email_verification_provider
    ) INTO v_snapshot
    FROM public.contacts WHERE id = NEW.contact_id;
  END IF;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'Sujet de revue introuvable' USING ERRCODE = 'P0002';
  END IF;
  NEW.prediction_snapshot := v_snapshot;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_resolution_quality_review_before_write ON public.resolution_quality_reviews;
CREATE TRIGGER snapshot_resolution_quality_review_before_write
  BEFORE INSERT OR UPDATE ON public.resolution_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_resolution_quality_review();

CREATE OR REPLACE FUNCTION public.review_resolution_subject(
  p_subject_type text,
  p_subject_id uuid,
  p_verdict text,
  p_dataset_version text,
  p_sampling_method text,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type NOT IN ('company', 'contact')
     OR p_verdict NOT IN ('correct', 'incorrect', 'uncertain') THEN
    RAISE EXCEPTION 'Sujet ou verdict invalide' USING ERRCODE = '22023';
  END IF;

  IF p_subject_type = 'company' THEN
    INSERT INTO public.resolution_quality_reviews(
      subject_type, company_enrichment_id, verdict, evidence, reviewed_by,
      reviewed_at, dataset_version, sampling_method
    ) VALUES (
      'company', p_subject_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb),
      auth.uid(), now(), p_dataset_version, p_sampling_method
    )
    ON CONFLICT (company_enrichment_id) WHERE company_enrichment_id IS NOT NULL
    DO UPDATE SET verdict = EXCLUDED.verdict, evidence = EXCLUDED.evidence,
      reviewed_by = auth.uid(), reviewed_at = now(),
      dataset_version = EXCLUDED.dataset_version, sampling_method = EXCLUDED.sampling_method
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.resolution_quality_reviews(
      subject_type, contact_id, verdict, evidence, reviewed_by,
      reviewed_at, dataset_version, sampling_method
    ) VALUES (
      'contact', p_subject_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb),
      auth.uid(), now(), p_dataset_version, p_sampling_method
    )
    ON CONFLICT (contact_id) WHERE contact_id IS NOT NULL
    DO UPDATE SET verdict = EXCLUDED.verdict, evidence = EXCLUDED.evidence,
      reviewed_by = auth.uid(), reviewed_at = now(),
      dataset_version = EXCLUDED.dataset_version, sampling_method = EXCLUDED.sampling_method
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_resolution_subject(text, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_resolution_subject(text, uuid, text, text, text, jsonb)
  TO authenticated, service_role;

DROP VIEW IF EXISTS public.enrichment_resolution_metrics;
CREATE VIEW public.enrichment_resolution_metrics
WITH (security_invoker = true)
AS
WITH company AS (
  SELECT
    count(*) FILTER (WHERE resolution_attempted_at IS NOT NULL) AS workflow_attempts,
    count(*) FILTER (WHERE resolution_technical_status = 'completed') AS technical_completed,
    count(*) FILTER (WHERE resolution_technical_status = 'failed') AS technical_failed,
    count(*) FILTER (
      WHERE resolution_technical_status = 'completed' AND resolution_status = 'resolved'
    ) AS resolved,
    count(*) FILTER (
      WHERE resolution_technical_status = 'completed' AND resolution_status = 'ambiguous'
    ) AS ambiguous,
    count(*) FILTER (
      WHERE resolution_technical_status = 'completed' AND resolution_status = 'rejected'
    ) AS rejected,
    count(*) FILTER (
      WHERE resolution_technical_status = 'completed' AND operational_profiles_count > 0
    ) AS attempts_with_operational_profile,
    COALESCE(sum(operational_profiles_count) FILTER (WHERE resolution_technical_status = 'completed'), 0) AS operational_profiles,
    COALESCE(sum(contact_candidates_resolved) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_resolved,
    COALESCE(sum(contact_candidates_ambiguous) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_ambiguous,
    COALESCE(sum(contact_candidates_rejected) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_rejected
  FROM public.company_enrichment
), email AS (
  SELECT
    count(*) FILTER (WHERE email_verification_status = 'verified') AS verified,
    count(*) FILTER (WHERE email_verification_status = 'rejected') AS rejected,
    count(*) FILTER (WHERE email_verification_status = 'not_found') AS not_found,
    count(*) FILTER (WHERE email_verification_status = 'not_attempted') AS not_attempted
  FROM public.contacts
), reviews AS (
  SELECT
    count(*) FILTER (
      WHERE subject_type = 'company' AND verdict IN ('correct', 'incorrect')
        AND prediction_snapshot IS NOT NULL AND dataset_version IS NOT NULL
    ) AS company_labelled,
    count(*) FILTER (
      WHERE subject_type = 'company' AND verdict = 'correct'
        AND prediction_snapshot IS NOT NULL AND dataset_version IS NOT NULL
    ) AS company_correct,
    count(*) FILTER (
      WHERE subject_type = 'contact' AND verdict IN ('correct', 'incorrect')
        AND prediction_snapshot IS NOT NULL AND dataset_version IS NOT NULL
    ) AS contact_labelled,
    count(*) FILTER (
      WHERE subject_type = 'contact' AND verdict = 'correct'
        AND prediction_snapshot IS NOT NULL AND dataset_version IS NOT NULL
    ) AS contact_correct
  FROM public.resolution_quality_reviews
)
SELECT now() AS measured_at,
  company.workflow_attempts AS company_workflow_attempts,
  company.technical_completed AS company_technical_completed,
  company.technical_failed AS company_technical_failed,
  round(company.technical_completed::numeric / NULLIF(company.workflow_attempts, 0), 4) AS technical_success_rate,
  company.resolved AS companies_resolved,
  company.ambiguous AS companies_ambiguous,
  company.rejected AS companies_rejected,
  round(company.resolved::numeric / NULLIF(company.technical_completed, 0), 4) AS company_resolution_rate_per_technical_completion,
  company.attempts_with_operational_profile AS company_attempts_with_operational_profile,
  company.operational_profiles,
  round(company.attempts_with_operational_profile::numeric / NULLIF(company.technical_completed, 0), 4)
    AS operational_profile_company_rate,
  company.contact_resolved AS contact_candidates_resolved,
  company.contact_ambiguous AS contact_candidates_ambiguous,
  company.contact_rejected AS contact_candidates_rejected,
  email.verified AS emails_verified,
  email.rejected AS emails_rejected,
  email.not_found AS emails_not_found,
  email.not_attempted AS email_verification_not_attempted,
  round(email.verified::numeric / NULLIF(email.verified + email.rejected + email.not_found, 0), 4)
    AS verified_email_rate_per_attempt,
  reviews.company_labelled, reviews.company_correct,
  round(reviews.company_correct::numeric / NULLIF(reviews.company_labelled, 0), 4) AS company_labelled_accuracy,
  reviews.contact_labelled, reviews.contact_correct,
  round(reviews.contact_correct::numeric / NULLIF(reviews.contact_labelled, 0), 4) AS contact_labelled_accuracy
FROM company CROSS JOIN email CROSS JOIN reviews;

CREATE OR REPLACE VIEW public.resolution_quality_metrics_by_dataset
WITH (security_invoker = true)
AS
SELECT subject_type, dataset_version, sampling_method,
  count(*) FILTER (WHERE verdict IN ('correct', 'incorrect')) AS labelled,
  count(*) FILTER (WHERE verdict = 'correct') AS correct,
  count(*) FILTER (WHERE verdict = 'incorrect') AS incorrect,
  count(*) FILTER (WHERE verdict = 'uncertain') AS uncertain,
  round(
    count(*) FILTER (WHERE verdict = 'correct')::numeric
    / NULLIF(count(*) FILTER (WHERE verdict IN ('correct', 'incorrect')), 0), 4
  ) AS labelled_accuracy
FROM public.resolution_quality_reviews
WHERE prediction_snapshot IS NOT NULL AND dataset_version IS NOT NULL AND sampling_method IS NOT NULL
GROUP BY subject_type, dataset_version, sampling_method;

REVOKE ALL ON public.enrichment_resolution_metrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resolution_quality_metrics_by_dataset FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.enrichment_resolution_metrics TO service_role;
GRANT SELECT ON public.resolution_quality_metrics_by_dataset TO service_role;
COMMENT ON VIEW public.enrichment_resolution_metrics IS
  'Mesure séparée de la disponibilité technique, résolution société, profils opérationnels et emails vérifiés; historique non instrumenté exclu.';

-- Preuves de résolution société/contact et de vérification email.
-- Les scores ci-dessous sont des scores de concordance des preuves, pas une précision mesurée.
ALTER TABLE IF EXISTS public.company_enrichment
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_score smallint,
  ADD COLUMN IF NOT EXISTS resolution_provenance jsonb,
  ADD COLUMN IF NOT EXISTS contact_resolution_measured_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_candidates_resolved integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_candidates_ambiguous integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contact_candidates_rejected integer NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.contacts
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_score smallint,
  ADD COLUMN IF NOT EXISTS resolution_provenance jsonb,
  ADD COLUMN IF NOT EXISTS email_verification_status text,
  ADD COLUMN IF NOT EXISTS email_verification_provider text,
  ADD COLUMN IF NOT EXISTS email_verification_qualification text,
  ADD COLUMN IF NOT EXISTS email_verification_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verification_provenance jsonb;

DO $$ BEGIN
  ALTER TABLE public.company_enrichment
    ADD CONSTRAINT company_enrichment_resolution_status_check
    CHECK (resolution_status IS NULL OR resolution_status IN ('resolved', 'ambiguous', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.company_enrichment
    ADD CONSTRAINT company_enrichment_resolution_score_check
    CHECK (resolution_score IS NULL OR resolution_score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.company_enrichment
    ADD CONSTRAINT company_enrichment_contact_candidate_counts_check
    CHECK (
      contact_candidates_resolved >= 0
      AND contact_candidates_ambiguous >= 0
      AND contact_candidates_rejected >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_resolution_status_check
    CHECK (resolution_status IS NULL OR resolution_status IN ('resolved', 'ambiguous', 'rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_resolution_score_check
    CHECK (resolution_score IS NULL OR resolution_score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_email_verification_status_check
    CHECK (
      email_verification_status IS NULL
      OR email_verification_status IN ('verified', 'rejected', 'not_found', 'not_attempted')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.contacts
    ADD CONSTRAINT contacts_email_verification_confidence_check
    CHECK (
      email_verification_confidence IS NULL
      OR email_verification_confidence BETWEEN 0 AND 1
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS company_enrichment_resolution_status_idx
  ON public.company_enrichment(resolution_status) WHERE resolution_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_resolution_status_idx
  ON public.contacts(resolution_status) WHERE resolution_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_email_verification_status_idx
  ON public.contacts(email_verification_status) WHERE email_verification_status IS NOT NULL;

COMMENT ON COLUMN public.company_enrichment.resolution_score IS
  'Score de concordance des preuves (0-100), non assimilable à une probabilité de justesse.';
COMMENT ON COLUMN public.contacts.resolution_score IS
  'Score de complétude/concordance des preuves (0-100), non assimilable à une probabilité de justesse.';
COMMENT ON COLUMN public.contacts.email_verification_confidence IS
  'Confiance quantitative renvoyée par le fournisseur ; NULL si le fournisseur ne fournit qu une qualification.';

-- Réservation atomique du crédit /entreprise. Le préflight Edge explique le solde ; cette
-- fonction est l'autorité contre les courses concurrentes et laisse une trace avant l'appel.
ALTER TABLE IF EXISTS public.pappers_credit_usage
  ADD COLUMN IF NOT EXISTS request_key text;
CREATE UNIQUE INDEX IF NOT EXISTS pappers_credit_usage_request_key_unique
  ON public.pappers_credit_usage(request_key) WHERE request_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_pappers_company_credit(
  p_request_key text,
  p_signal_id uuid,
  p_run_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_plan public.pappers_plan_settings%ROWTYPE;
  v_used numeric := 0;
  v_usage_id uuid;
BEGIN
  IF coalesce(trim(p_request_key), '') = '' THEN
    RAISE EXCEPTION 'request_key Pappers obligatoire';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:credits', 0));

  IF EXISTS (SELECT 1 FROM public.pappers_credit_usage WHERE request_key = p_request_key) THEN
    RAISE EXCEPTION 'appel Pappers déjà réservé: %', p_request_key;
  END IF;

  SELECT * INTO v_plan
  FROM public.pappers_plan_settings
  ORDER BY updated_at DESC, created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan Pappers absent'; END IF;
  IF v_plan.monthly_credits <= 0 THEN RAISE EXCEPTION 'plan Pappers à 0'; END IF;
  IF current_date < v_plan.current_period_start OR current_date > v_plan.current_period_end THEN
    RAISE EXCEPTION 'période Pappers non courante: % - %', v_plan.current_period_start, v_plan.current_period_end;
  END IF;

  SELECT coalesce(sum(
    credits_used + CASE WHEN details->>'status' = 'reserved' THEN 1 ELSE 0 END
  ), 0) INTO v_used
  FROM public.pappers_credit_usage
  WHERE date BETWEEN v_plan.current_period_start AND v_plan.current_period_end;
  IF v_used + 1 > v_plan.monthly_credits THEN
    RAISE EXCEPTION 'quota Pappers épuisé: %/%', v_used, v_plan.monthly_credits;
  END IF;

  INSERT INTO public.pappers_credit_usage (
    date, credits_used, search_credits, company_credits, api_calls, request_key, details
  ) VALUES (
    current_date, 0, 0, 0, 0, p_request_key,
    jsonb_build_object(
      'operation', 'entreprise',
      'status', 'reserved',
      'signal_id', p_signal_id,
      'run_id', p_run_id,
      'reserved_at', now()
    )
  )
  RETURNING id INTO v_usage_id;

  RETURN jsonb_build_object(
    'usage_id', v_usage_id,
    'used_before', v_used,
    'used_after', v_used + 1,
    'limit', v_plan.monthly_credits
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pappers_company_credit(
  p_usage_id uuid,
  p_request_key text,
  p_signal_id uuid,
  p_run_id uuid,
  p_success boolean,
  p_http_status integer DEFAULT NULL,
  p_error_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.pappers_credit_usage
  SET credits_used = 1,
      company_credits = 1,
      api_calls = 1,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
    'status', CASE WHEN p_success THEN 'completed' ELSE 'failed' END,
    'http_status', p_http_status,
    'error_code', p_error_code,
    'completed_at', now()
  )
  WHERE id = p_usage_id AND request_key = p_request_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'réservation Pappers introuvable: %', p_request_key; END IF;

  INSERT INTO public.provider_usage_events (
    provider, operation, run_id, signal_id, request_key, units,
    requests_count, items_count, success, error_code, metadata
  ) VALUES (
    'pappers', 'entreprise', p_run_id, p_signal_id, p_request_key,
    1,
    1, CASE WHEN p_success THEN 1 ELSE 0 END, p_success, p_error_code,
    jsonb_build_object('http_status', p_http_status, 'pappers_credit_usage_id', p_usage_id)
  )
  ON CONFLICT (provider, request_key) WHERE request_key IS NOT NULL
  DO UPDATE SET
    success = EXCLUDED.success,
    error_code = EXCLUDED.error_code,
    metadata = EXCLUDED.metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_pappers_company_credit(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_pappers_company_credit(uuid, text, uuid, uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_pappers_company_credit(text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pappers_company_credit(uuid, text, uuid, uuid, boolean, integer, text) TO service_role;

-- Les taux de justesse ne deviennent réels qu'après revue. Sans libellé, l'accuracy reste NULL.
CREATE TABLE IF NOT EXISTS public.resolution_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('company', 'contact')),
  company_enrichment_id uuid REFERENCES public.company_enrichment(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'uncertain')),
  evidence jsonb NOT NULL DEFAULT '{}',
  reviewed_by uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (subject_type = 'company' AND company_enrichment_id IS NOT NULL AND contact_id IS NULL)
    OR (subject_type = 'contact' AND contact_id IS NOT NULL AND company_enrichment_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS resolution_quality_reviews_company_unique
  ON public.resolution_quality_reviews(company_enrichment_id)
  WHERE company_enrichment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS resolution_quality_reviews_contact_unique
  ON public.resolution_quality_reviews(contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE public.resolution_quality_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resolution_quality_reviews_service_all ON public.resolution_quality_reviews;
CREATE POLICY resolution_quality_reviews_service_all ON public.resolution_quality_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.resolution_quality_reviews FROM anon, authenticated;
GRANT ALL ON public.resolution_quality_reviews TO service_role;

CREATE OR REPLACE VIEW public.enrichment_resolution_metrics
WITH (security_invoker = true)
AS
WITH company AS (
  SELECT
    count(*) FILTER (WHERE resolution_status IS NOT NULL) AS attempts,
    count(*) FILTER (WHERE resolution_status = 'resolved') AS resolved,
    count(*) FILTER (WHERE resolution_status = 'ambiguous') AS ambiguous,
    count(*) FILTER (WHERE resolution_status = 'rejected') AS rejected,
    coalesce(sum(contact_candidates_resolved) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_resolved,
    coalesce(sum(contact_candidates_ambiguous) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_ambiguous,
    coalesce(sum(contact_candidates_rejected) FILTER (WHERE contact_resolution_measured_at IS NOT NULL), 0) AS contact_rejected
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
    count(*) FILTER (WHERE subject_type = 'company' AND verdict IN ('correct', 'incorrect')) AS company_labelled,
    count(*) FILTER (WHERE subject_type = 'company' AND verdict = 'correct') AS company_correct,
    count(*) FILTER (WHERE subject_type = 'contact' AND verdict IN ('correct', 'incorrect')) AS contact_labelled,
    count(*) FILTER (WHERE subject_type = 'contact' AND verdict = 'correct') AS contact_correct
  FROM public.resolution_quality_reviews
)
SELECT
  now() AS measured_at,
  company.attempts AS company_attempts,
  company.resolved AS companies_resolved,
  company.ambiguous AS companies_ambiguous,
  company.rejected AS companies_rejected,
  round(company.resolved::numeric / nullif(company.attempts, 0), 4) AS company_resolution_rate,
  company.contact_resolved AS contact_candidates_resolved,
  company.contact_ambiguous AS contact_candidates_ambiguous,
  company.contact_rejected AS contact_candidates_rejected,
  round(
    company.contact_resolved::numeric
    / nullif(company.contact_resolved + company.contact_ambiguous + company.contact_rejected, 0),
    4
  ) AS contact_resolution_rate,
  email.verified AS emails_verified,
  email.rejected AS emails_rejected,
  email.not_found AS emails_not_found,
  email.not_attempted AS email_verification_not_attempted,
  round(email.verified::numeric / nullif(email.verified + email.rejected + email.not_found, 0), 4)
    AS verified_email_rate_per_attempt,
  reviews.company_labelled,
  reviews.company_correct,
  round(reviews.company_correct::numeric / nullif(reviews.company_labelled, 0), 4) AS company_labelled_accuracy,
  reviews.contact_labelled,
  reviews.contact_correct,
  round(reviews.contact_correct::numeric / nullif(reviews.contact_labelled, 0), 4) AS contact_labelled_accuracy
FROM company CROSS JOIN email CROSS JOIN reviews;

COMMENT ON VIEW public.enrichment_resolution_metrics IS
  'Métriques d opérations. Les accuracies restent NULL sans revue humaine correcte/incorrecte.';
REVOKE ALL ON public.enrichment_resolution_metrics FROM anon, authenticated;
GRANT SELECT ON public.enrichment_resolution_metrics TO service_role;

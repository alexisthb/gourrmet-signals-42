-- Les jeux de vérité sont des preuves historiques. Une nouvelle révision de
-- modèle, d'algorithme ou de dataset crée une cohorte distincte au lieu de
-- déplacer/réécrire les labels précédents.

ALTER TABLE public.press_signal_quality_reviews
  DROP CONSTRAINT IF EXISTS press_signal_quality_reviews_signal_id_fkey,
  DROP CONSTRAINT IF EXISTS press_signal_quality_reviews_signal_id_key;
ALTER TABLE public.press_signal_quality_reviews
  ADD CONSTRAINT press_signal_quality_reviews_signal_id_fkey
  FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE RESTRICT;

ALTER TABLE public.press_expected_opportunities
  DROP CONSTRAINT IF EXISTS press_expected_opportunities_raw_article_id_fkey,
  DROP CONSTRAINT IF EXISTS press_expected_opportunities_matched_signal_id_fkey;
ALTER TABLE public.press_expected_opportunities
  ADD CONSTRAINT press_expected_opportunities_raw_article_id_fkey
  FOREIGN KEY (raw_article_id) REFERENCES public.raw_articles(id) ON DELETE RESTRICT,
  ADD CONSTRAINT press_expected_opportunities_matched_signal_id_fkey
  FOREIGN KEY (matched_signal_id) REFERENCES public.signals(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.press_expected_opportunity_unique;
DROP INDEX IF EXISTS public.press_expected_matched_signal_unique;

ALTER TABLE public.press_signal_quality_reviews
  DISABLE TRIGGER snapshot_press_signal_review_before_write;
ALTER TABLE public.press_expected_opportunities
  DISABLE TRIGGER press_expected_opportunity_match_check;

-- Compatibilité si une étape partielle a déjà créé des labels avant cette
-- migration. Ils restent identifiés comme non comparables aux cohortes futures.
UPDATE public.press_signal_quality_reviews review
SET dataset_version = COALESCE(NULLIF(review.dataset_version, ''), 'legacy_unversioned'),
    sampling_method = COALESCE(review.sampling_method, 'ad_hoc'),
    model_revision = COALESCE(NULLIF(review.model_revision, ''), 'legacy_unversioned'),
    prompt_hash = COALESCE(NULLIF(review.prompt_hash, ''), 'legacy_unversioned'),
    predicted_company_name = COALESCE(review.predicted_company_name, signal.company_name),
    predicted_signal_type = COALESCE(review.predicted_signal_type, signal.signal_type),
    raw_article_id = COALESCE(review.raw_article_id, signal.article_id)
FROM public.signals signal
WHERE signal.id = review.signal_id;

UPDATE public.press_expected_opportunities
SET dataset_version = COALESCE(NULLIF(dataset_version, ''), 'legacy_unversioned'),
    sampling_method = COALESCE(sampling_method, 'ad_hoc'),
    model_revision = COALESCE(NULLIF(model_revision, ''), 'legacy_unversioned'),
    prompt_hash = COALESCE(NULLIF(prompt_hash, ''), 'legacy_unversioned');

-- L'ancienne normalisation distinguait les accents. La nouvelle cohorte ne le
-- fait plus : on conserve d'abord une ligne déjà appariée, sinon la revue la
-- plus récente, avant de poser l'unicité plus stricte.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY raw_article_id,
             public.normalize_company_label(expected_company_name),
             expected_signal_type, dataset_version, model_revision, prompt_hash
           ORDER BY (matched_signal_id IS NOT NULL) DESC,
                    reviewed_at DESC, created_at DESC, id DESC
         ) AS cohort_rank
  FROM public.press_expected_opportunities
)
DELETE FROM public.press_expected_opportunities opportunity
USING ranked
WHERE opportunity.id = ranked.id AND ranked.cohort_rank > 1;

CREATE UNIQUE INDEX press_signal_review_cohort_unique
  ON public.press_signal_quality_reviews(
    signal_id, dataset_version, model_revision, prompt_hash
  );
CREATE UNIQUE INDEX press_expected_opportunity_cohort_unique
  ON public.press_expected_opportunities(
    raw_article_id,
    public.normalize_company_label(expected_company_name),
    expected_signal_type,
    dataset_version,
    model_revision,
    prompt_hash
  );
CREATE UNIQUE INDEX press_expected_match_cohort_unique
  ON public.press_expected_opportunities(
    matched_signal_id, dataset_version, model_revision, prompt_hash
  )
  WHERE matched_signal_id IS NOT NULL;

ALTER TABLE public.press_expected_opportunities
  ADD COLUMN IF NOT EXISTS matched_company_name text,
  ADD COLUMN IF NOT EXISTS matched_signal_type text,
  ADD COLUMN IF NOT EXISTS matched_raw_article_id uuid,
  ADD COLUMN IF NOT EXISTS matched_model_revision text,
  ADD COLUMN IF NOT EXISTS matched_prompt_hash text;

UPDATE public.press_expected_opportunities expected
SET matched_company_name = signal.company_name,
    matched_signal_type = signal.signal_type,
    matched_raw_article_id = signal.article_id,
    matched_model_revision = signal.detection_model_revision,
    matched_prompt_hash = signal.detection_prompt_hash
FROM public.signals signal
WHERE signal.id = expected.matched_signal_id;

CREATE OR REPLACE FUNCTION public.snapshot_press_signal_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.signal_id := OLD.signal_id;
    NEW.predicted_company_name := OLD.predicted_company_name;
    NEW.predicted_signal_type := OLD.predicted_signal_type;
    NEW.raw_article_id := OLD.raw_article_id;
    NEW.model_revision := OLD.model_revision;
    NEW.prompt_hash := OLD.prompt_hash;
    NEW.dataset_version := OLD.dataset_version;
    NEW.sampling_method := OLD.sampling_method;
    RETURN NEW;
  END IF;

  SELECT * INTO v_signal FROM public.signals WHERE id = NEW.signal_id;
  IF NOT FOUND OR v_signal.article_id IS NULL THEN
    RAISE EXCEPTION 'Seul un signal Presse relié à un article peut être revu'
      USING ERRCODE = '23514';
  END IF;
  IF COALESCE(trim(v_signal.detection_model_revision), '') = ''
     OR COALESCE(trim(v_signal.detection_prompt_hash), '') = '' THEN
    RAISE EXCEPTION 'Signal sans révision de détection mesurable'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(trim(NEW.dataset_version), '') = '' OR NEW.sampling_method IS NULL THEN
    RAISE EXCEPTION 'dataset_version et sampling_method sont obligatoires'
      USING ERRCODE = '22023';
  END IF;

  NEW.predicted_company_name := v_signal.company_name;
  NEW.predicted_signal_type := v_signal.signal_type;
  NEW.raw_article_id := v_signal.article_id;
  NEW.model_revision := v_signal.detection_model_revision;
  NEW.prompt_hash := v_signal.detection_prompt_hash;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_press_expected_opportunity_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.raw_article_id IS DISTINCT FROM OLD.raw_article_id
    OR NEW.expected_company_name IS DISTINCT FROM OLD.expected_company_name
    OR NEW.expected_signal_type IS DISTINCT FROM OLD.expected_signal_type
    OR NEW.model_revision IS DISTINCT FROM OLD.model_revision
    OR NEW.prompt_hash IS DISTINCT FROM OLD.prompt_hash
    OR NEW.dataset_version IS DISTINCT FROM OLD.dataset_version
    OR NEW.sampling_method IS DISTINCT FROM OLD.sampling_method
  ) THEN
    RAISE EXCEPTION 'La cohorte d une opportunité attendue est immuable'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(trim(NEW.dataset_version), '') = ''
     OR NEW.sampling_method IS NULL
     OR COALESCE(trim(NEW.model_revision), '') = ''
     OR COALESCE(trim(NEW.prompt_hash), '') = '' THEN
    RAISE EXCEPTION 'Révision, prompt, dataset et échantillonnage sont obligatoires'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.matched_signal_id IS NULL THEN
    NEW.matched_company_name := NULL;
    NEW.matched_signal_type := NULL;
    NEW.matched_raw_article_id := NULL;
    NEW.matched_model_revision := NULL;
    NEW.matched_prompt_hash := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.matched_signal_id IS NOT DISTINCT FROM OLD.matched_signal_id THEN
    NEW.matched_company_name := OLD.matched_company_name;
    NEW.matched_signal_type := OLD.matched_signal_type;
    NEW.matched_raw_article_id := OLD.matched_raw_article_id;
    NEW.matched_model_revision := OLD.matched_model_revision;
    NEW.matched_prompt_hash := OLD.matched_prompt_hash;
    RETURN NEW;
  END IF;

  SELECT * INTO v_signal FROM public.signals WHERE id = NEW.matched_signal_id;
  IF NOT FOUND
     OR v_signal.article_id IS DISTINCT FROM NEW.raw_article_id
     OR v_signal.signal_type IS DISTINCT FROM NEW.expected_signal_type
     OR v_signal.detection_model_revision IS DISTINCT FROM NEW.model_revision
     OR v_signal.detection_prompt_hash IS DISTINCT FROM NEW.prompt_hash
     OR public.normalize_company_label(v_signal.company_name)
        IS DISTINCT FROM public.normalize_company_label(NEW.expected_company_name) THEN
    RAISE EXCEPTION 'Le match doit avoir le même article, type, société, modèle et prompt'
      USING ERRCODE = '23514';
  END IF;
  NEW.matched_company_name := v_signal.company_name;
  NEW.matched_signal_type := v_signal.signal_type;
  NEW.matched_raw_article_id := v_signal.article_id;
  NEW.matched_model_revision := v_signal.detection_model_revision;
  NEW.matched_prompt_hash := v_signal.detection_prompt_hash;
  RETURN NEW;
END;
$$;

ALTER TABLE public.press_signal_quality_reviews
  ENABLE TRIGGER snapshot_press_signal_review_before_write;
ALTER TABLE public.press_expected_opportunities
  ENABLE TRIGGER press_expected_opportunity_match_check;

CREATE OR REPLACE FUNCTION public.review_press_signal(
  p_signal_id uuid,
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
DECLARE
  v_signal public.signals%ROWTYPE;
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_verdict NOT IN ('correct', 'incorrect', 'uncertain') THEN
    RAISE EXCEPTION 'Verdict invalide' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_signal FROM public.signals WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal introuvable' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.press_signal_quality_reviews(
    signal_id, verdict, evidence, reviewed_by, reviewed_at,
    dataset_version, sampling_method
  ) VALUES (
    p_signal_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb), auth.uid(), now(),
    p_dataset_version, p_sampling_method
  )
  ON CONFLICT (signal_id, dataset_version, model_revision, prompt_hash)
  DO UPDATE SET verdict = EXCLUDED.verdict,
    evidence = EXCLUDED.evidence,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_press_expected_opportunity(
  p_raw_article_id uuid,
  p_expected_company_name text,
  p_expected_signal_type text,
  p_matched_signal_id uuid,
  p_model_revision text,
  p_prompt_hash text,
  p_dataset_version text,
  p_sampling_method text,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'gourrmet:press-review:' || p_raw_article_id::text || ':'
    || public.normalize_company_label(p_expected_company_name) || ':'
    || p_expected_signal_type || ':' || p_dataset_version || ':'
    || p_model_revision || ':' || p_prompt_hash,
    0
  ));

  SELECT id INTO v_id
  FROM public.press_expected_opportunities
  WHERE raw_article_id = p_raw_article_id
    AND public.normalize_company_label(expected_company_name)
        = public.normalize_company_label(p_expected_company_name)
    AND expected_signal_type = p_expected_signal_type
    AND dataset_version = p_dataset_version
    AND model_revision = p_model_revision
    AND prompt_hash = p_prompt_hash
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.press_expected_opportunities
    SET matched_signal_id = p_matched_signal_id,
        evidence = COALESCE(p_evidence, '{}'::jsonb),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.press_expected_opportunities(
      raw_article_id, expected_company_name, expected_signal_type,
      matched_signal_id, model_revision, prompt_hash, dataset_version,
      sampling_method, evidence, reviewed_by, reviewed_at
    ) VALUES (
      p_raw_article_id, p_expected_company_name, p_expected_signal_type,
      p_matched_signal_id, p_model_revision, p_prompt_hash, p_dataset_version,
      p_sampling_method, COALESCE(p_evidence, '{}'::jsonb), auth.uid(), now()
    ) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

DROP VIEW IF EXISTS public.press_detection_quality_metrics;
CREATE VIEW public.press_detection_quality_metrics
WITH (security_invoker = true)
AS
WITH precision_groups AS (
  SELECT review.model_revision, review.prompt_hash, review.dataset_version,
         review.sampling_method,
         count(*) FILTER (WHERE review.verdict IN ('correct', 'incorrect'))::numeric
           AS labelled_predictions,
         count(*) FILTER (WHERE review.verdict = 'correct')::numeric
           AS correct_predictions,
         count(*) FILTER (WHERE review.verdict = 'incorrect')::numeric
           AS incorrect_predictions,
         count(*) FILTER (WHERE review.verdict = 'uncertain')::numeric
           AS uncertain_predictions,
         count(*) FILTER (
           WHERE signal.id IS NULL
             OR signal.article_id IS DISTINCT FROM review.raw_article_id
             OR signal.signal_type IS DISTINCT FROM review.predicted_signal_type
             OR signal.detection_model_revision IS DISTINCT FROM review.model_revision
             OR signal.detection_prompt_hash IS DISTINCT FROM review.prompt_hash
             OR public.normalize_company_label(signal.company_name)
                IS DISTINCT FROM public.normalize_company_label(review.predicted_company_name)
         )::numeric AS current_integrity_mismatches
  FROM public.press_signal_quality_reviews review
  LEFT JOIN public.signals signal ON signal.id = review.signal_id
  WHERE review.model_revision IS NOT NULL AND review.prompt_hash IS NOT NULL
    AND review.dataset_version IS NOT NULL AND review.sampling_method IS NOT NULL
  GROUP BY review.model_revision, review.prompt_hash, review.dataset_version,
           review.sampling_method
), recall_groups AS (
  SELECT expected.model_revision, expected.prompt_hash, expected.dataset_version,
         expected.sampling_method,
         count(*)::numeric AS expected_opportunities,
         count(*) FILTER (
           WHERE expected.matched_signal_id IS NOT NULL
             AND expected.matched_raw_article_id = expected.raw_article_id
             AND expected.matched_signal_type = expected.expected_signal_type
             AND expected.matched_model_revision = expected.model_revision
             AND expected.matched_prompt_hash = expected.prompt_hash
             AND public.normalize_company_label(expected.matched_company_name)
                 = public.normalize_company_label(expected.expected_company_name)
         )::numeric AS matched_opportunities,
         count(*) FILTER (
           WHERE expected.matched_signal_id IS NOT NULL
             AND (
               signal.id IS NULL
               OR signal.article_id IS DISTINCT FROM expected.matched_raw_article_id
               OR signal.signal_type IS DISTINCT FROM expected.matched_signal_type
               OR signal.detection_model_revision IS DISTINCT FROM expected.matched_model_revision
               OR signal.detection_prompt_hash IS DISTINCT FROM expected.matched_prompt_hash
               OR public.normalize_company_label(signal.company_name)
                  IS DISTINCT FROM public.normalize_company_label(expected.matched_company_name)
             )
         )::numeric AS current_match_integrity_mismatches
  FROM public.press_expected_opportunities expected
  LEFT JOIN public.signals signal ON signal.id = expected.matched_signal_id
  WHERE expected.model_revision IS NOT NULL AND expected.prompt_hash IS NOT NULL
    AND expected.dataset_version IS NOT NULL AND expected.sampling_method IS NOT NULL
  GROUP BY expected.model_revision, expected.prompt_hash, expected.dataset_version,
           expected.sampling_method
), combined AS (
  SELECT COALESCE(p.model_revision, r.model_revision) AS model_revision,
         COALESCE(p.prompt_hash, r.prompt_hash) AS prompt_hash,
         COALESCE(p.dataset_version, r.dataset_version) AS dataset_version,
         COALESCE(p.sampling_method, r.sampling_method) AS sampling_method,
         COALESCE(p.labelled_predictions, 0) AS labelled_predictions,
         COALESCE(p.correct_predictions, 0) AS correct_predictions,
         COALESCE(p.incorrect_predictions, 0) AS incorrect_predictions,
         COALESCE(p.uncertain_predictions, 0) AS uncertain_predictions,
         COALESCE(p.current_integrity_mismatches, 0) AS current_integrity_mismatches,
         COALESCE(r.expected_opportunities, 0) AS expected_opportunities,
         COALESCE(r.matched_opportunities, 0) AS matched_opportunities,
         COALESCE(r.current_match_integrity_mismatches, 0)
           AS current_match_integrity_mismatches
  FROM precision_groups p
  FULL JOIN recall_groups r
    USING (model_revision, prompt_hash, dataset_version, sampling_method)
)
SELECT now() AS measured_at, combined.*,
       round(correct_predictions / NULLIF(labelled_predictions, 0), 4)
         AS labelled_precision,
       round(matched_opportunities / NULLIF(expected_opportunities, 0), 4)
         AS labelled_recall
FROM combined;

-- Résolution société/contact : même règle, avec la révision d'algorithme
-- extraite du snapshot de provenance.
ALTER TABLE public.resolution_quality_reviews
  ADD COLUMN IF NOT EXISTS algorithm_revision text;

ALTER TABLE public.resolution_quality_reviews
  DROP CONSTRAINT IF EXISTS resolution_quality_reviews_company_enrichment_id_fkey,
  DROP CONSTRAINT IF EXISTS resolution_quality_reviews_contact_id_fkey;
ALTER TABLE public.resolution_quality_reviews
  ADD CONSTRAINT resolution_quality_reviews_company_enrichment_id_fkey
  FOREIGN KEY (company_enrichment_id) REFERENCES public.company_enrichment(id) ON DELETE RESTRICT,
  ADD CONSTRAINT resolution_quality_reviews_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS public.resolution_quality_reviews_company_unique;
DROP INDEX IF EXISTS public.resolution_quality_reviews_contact_unique;

ALTER TABLE public.resolution_quality_reviews
  DISABLE TRIGGER snapshot_resolution_quality_review_before_write;

UPDATE public.resolution_quality_reviews
SET dataset_version = COALESCE(NULLIF(dataset_version, ''), 'legacy_unversioned'),
    sampling_method = COALESCE(sampling_method, 'ad_hoc'),
    algorithm_revision = COALESCE(
      NULLIF(prediction_snapshot #>> '{resolution_provenance,algorithm}', ''),
      'legacy_unversioned'
    );

CREATE UNIQUE INDEX resolution_quality_reviews_company_cohort_unique
  ON public.resolution_quality_reviews(
    company_enrichment_id, dataset_version, algorithm_revision
  ) WHERE company_enrichment_id IS NOT NULL;
CREATE UNIQUE INDEX resolution_quality_reviews_contact_cohort_unique
  ON public.resolution_quality_reviews(
    contact_id, dataset_version, algorithm_revision
  ) WHERE contact_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.snapshot_resolution_quality_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.subject_type := OLD.subject_type;
    NEW.company_enrichment_id := OLD.company_enrichment_id;
    NEW.contact_id := OLD.contact_id;
    NEW.prediction_snapshot := OLD.prediction_snapshot;
    NEW.dataset_version := OLD.dataset_version;
    NEW.sampling_method := OLD.sampling_method;
    NEW.algorithm_revision := OLD.algorithm_revision;
    RETURN NEW;
  END IF;
  IF COALESCE(trim(NEW.dataset_version), '') = '' OR NEW.sampling_method IS NULL THEN
    RAISE EXCEPTION 'dataset_version et sampling_method sont obligatoires'
      USING ERRCODE = '22023';
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
  NEW.algorithm_revision := COALESCE(
    NULLIF(v_snapshot #>> '{resolution_provenance,algorithm}', ''),
    'unversioned'
  );
  RETURN NEW;
END;
$$;

ALTER TABLE public.resolution_quality_reviews
  ENABLE TRIGGER snapshot_resolution_quality_review_before_write;

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
DECLARE
  v_algorithm text;
  v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_subject_type NOT IN ('company', 'contact')
     OR p_verdict NOT IN ('correct', 'incorrect', 'uncertain') THEN
    RAISE EXCEPTION 'Sujet ou verdict invalide' USING ERRCODE = '22023';
  END IF;

  IF p_subject_type = 'company' THEN
    SELECT COALESCE(NULLIF(resolution_provenance->>'algorithm', ''), 'unversioned')
    INTO v_algorithm
    FROM public.company_enrichment WHERE id = p_subject_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Société introuvable' USING ERRCODE = 'P0002'; END IF;

    INSERT INTO public.resolution_quality_reviews(
      subject_type, company_enrichment_id, verdict, evidence, reviewed_by,
      reviewed_at, dataset_version, sampling_method
    ) VALUES (
      'company', p_subject_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb),
      auth.uid(), now(), p_dataset_version, p_sampling_method
    )
    ON CONFLICT (company_enrichment_id, dataset_version, algorithm_revision)
      WHERE company_enrichment_id IS NOT NULL
    DO UPDATE SET verdict = EXCLUDED.verdict,
      evidence = EXCLUDED.evidence,
      reviewed_by = auth.uid(),
      reviewed_at = now()
    RETURNING id INTO v_id;
  ELSE
    SELECT COALESCE(NULLIF(resolution_provenance->>'algorithm', ''), 'unversioned')
    INTO v_algorithm
    FROM public.contacts WHERE id = p_subject_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Contact introuvable' USING ERRCODE = 'P0002'; END IF;

    INSERT INTO public.resolution_quality_reviews(
      subject_type, contact_id, verdict, evidence, reviewed_by,
      reviewed_at, dataset_version, sampling_method
    ) VALUES (
      'contact', p_subject_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb),
      auth.uid(), now(), p_dataset_version, p_sampling_method
    )
    ON CONFLICT (contact_id, dataset_version, algorithm_revision)
      WHERE contact_id IS NOT NULL
    DO UPDATE SET verdict = EXCLUDED.verdict,
      evidence = EXCLUDED.evidence,
      reviewed_by = auth.uid(),
      reviewed_at = now()
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

DROP VIEW IF EXISTS public.resolution_quality_metrics_by_dataset;
CREATE VIEW public.resolution_quality_metrics_by_dataset
WITH (security_invoker = true)
AS
SELECT subject_type, algorithm_revision, dataset_version, sampling_method,
  count(*) FILTER (WHERE verdict IN ('correct', 'incorrect')) AS labelled,
  count(*) FILTER (WHERE verdict = 'correct') AS correct,
  count(*) FILTER (WHERE verdict = 'incorrect') AS incorrect,
  count(*) FILTER (WHERE verdict = 'uncertain') AS uncertain,
  round(
    count(*) FILTER (WHERE verdict = 'correct')::numeric
    / NULLIF(count(*) FILTER (WHERE verdict IN ('correct', 'incorrect')), 0), 4
  ) AS labelled_accuracy
FROM public.resolution_quality_reviews
WHERE prediction_snapshot IS NOT NULL
  AND dataset_version IS NOT NULL
  AND sampling_method IS NOT NULL
  AND algorithm_revision IS NOT NULL
GROUP BY subject_type, algorithm_revision, dataset_version, sampling_method;

REVOKE ALL ON public.press_detection_quality_metrics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.resolution_quality_metrics_by_dataset FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.press_detection_quality_metrics TO service_role;
GRANT SELECT ON public.resolution_quality_metrics_by_dataset TO service_role;

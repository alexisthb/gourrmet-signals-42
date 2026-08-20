-- Bail explicite des runs Presse : une Edge Function interrompue ne bloque plus
-- les scans suivants à vie, tout en conservant l'invariant d'un seul run actif.
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS detection_model_revision text,
  ADD COLUMN IF NOT EXISTS detection_prompt_hash text;

-- Un run déjà actif au moment de la migration ne possède pas encore de token.
-- On lui affecte une valeur opaque pour rendre l'invariant vérifiable ; aucune
-- nouvelle invocation ne pourra la deviner pour le reprendre et il expirera si
-- l'ancien bundle ne termine pas avant le déploiement coordonné des fonctions.
UPDATE public.scan_logs
SET lease_token = gen_random_uuid()
WHERE status = 'running' AND lease_token IS NULL;

DO $$ BEGIN
  ALTER TABLE public.scan_logs
    ADD CONSTRAINT scan_logs_running_lease_token_check
    CHECK (status <> 'running' OR lease_token IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS detection_model_revision text,
  ADD COLUMN IF NOT EXISTS detection_prompt_hash text;

CREATE INDEX IF NOT EXISTS scan_logs_lease_idx
  ON public.scan_logs(status, lease_expires_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS scan_logs_lease_fence_idx
  ON public.scan_logs(id, lease_token)
  WHERE status = 'running';

DROP FUNCTION IF EXISTS public.claim_press_scan(uuid, integer);
CREATE OR REPLACE FUNCTION public.claim_press_scan(
  p_scan_log_id uuid DEFAULT NULL,
  p_lease_token uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_active public.scan_logs%ROWTYPE;
  v_new_id uuid;
  v_new_token uuid;
  v_lease interval;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 60 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'Bail Presse invalide' USING ERRCODE = '22023';
  END IF;
  v_lease := make_interval(secs => p_lease_seconds);
  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:press:active-run', 0));

  IF p_scan_log_id IS NOT NULL THEN
    IF p_lease_token IS NULL THEN
      RAISE EXCEPTION 'Token de bail Presse requis pour reprendre %', p_scan_log_id
        USING ERRCODE = '22023';
    END IF;
    v_new_token := gen_random_uuid();
    UPDATE public.scan_logs
    SET heartbeat_at = now(),
        lease_expires_at = now() + v_lease,
        lease_token = v_new_token
    WHERE id = p_scan_log_id
      AND status = 'running'
      AND lease_token = p_lease_token
      AND lease_expires_at > now()
    RETURNING * INTO v_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bail Presse perdu, expiré ou déjà repris: %', p_scan_log_id
        USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'id', v_active.id,
      'lease_token', v_new_token,
      'should_start', true,
      'resumed', true
    );
  END IF;

  IF p_lease_token IS NOT NULL THEN
    RAISE EXCEPTION 'Un token de bail sans identifiant de run est invalide'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_active
  FROM public.scan_logs
  WHERE status = 'running'
  ORDER BY started_at DESC NULLS LAST, created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- Le CASE est parenthésé : dans une condition IF, PL/pgSQL termine
    -- l'expression au premier THEN rencontré à profondeur de parenthèses nulle.
    -- Sans ces parenthèses, c'est le THEN du CASE qui ferme la condition et la
    -- fonction ne compile pas (« syntax error at end of input »).
    IF COALESCE(v_active.lease_expires_at, v_active.heartbeat_at, v_active.started_at, v_active.created_at)
       >= now() - (CASE WHEN v_active.lease_expires_at IS NULL THEN interval '15 minutes' ELSE interval '0 seconds' END)
       AND (v_active.lease_expires_at IS NULL OR v_active.lease_expires_at > now()) THEN
      RETURN jsonb_build_object('id', v_active.id, 'should_start', false, 'resumed', false);
    END IF;

    UPDATE public.scan_logs
    SET status = 'failed', completed_at = now(), lease_expires_at = NULL, lease_token = NULL,
        error_message = 'Run expiré: aucun heartbeat avant la fin du bail'
    WHERE id = v_active.id AND status = 'running' AND lease_token = v_active.lease_token;
  END IF;

  v_new_token := gen_random_uuid();
  INSERT INTO public.scan_logs(status, heartbeat_at, lease_expires_at, lease_token)
  VALUES ('running', now(), now() + v_lease, v_new_token)
  RETURNING id INTO v_new_id;
  RETURN jsonb_build_object(
    'id', v_new_id,
    'lease_token', v_new_token,
    'should_start', true,
    'resumed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_press_scan(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_press_scan(uuid, uuid, integer) TO service_role;

-- Snapshot de la prédiction revue et cadre d'échantillonnage. Une métrique sans
-- dataset/version de modèle reste explicitement hors KPI.
ALTER TABLE public.press_signal_quality_reviews
  ADD COLUMN IF NOT EXISTS predicted_company_name text,
  ADD COLUMN IF NOT EXISTS predicted_signal_type text,
  ADD COLUMN IF NOT EXISTS raw_article_id uuid REFERENCES public.raw_articles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model_revision text,
  ADD COLUMN IF NOT EXISTS prompt_hash text,
  ADD COLUMN IF NOT EXISTS dataset_version text,
  ADD COLUMN IF NOT EXISTS sampling_method text;

ALTER TABLE public.press_expected_opportunities
  ADD COLUMN IF NOT EXISTS model_revision text,
  ADD COLUMN IF NOT EXISTS prompt_hash text,
  ADD COLUMN IF NOT EXISTS dataset_version text,
  ADD COLUMN IF NOT EXISTS sampling_method text;

DO $$ BEGIN
  ALTER TABLE public.press_signal_quality_reviews
    ADD CONSTRAINT press_review_sampling_method_check
    CHECK (sampling_method IS NULL OR sampling_method IN ('random', 'stratified', 'exhaustive', 'ad_hoc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.press_expected_opportunities
    ADD CONSTRAINT press_expected_sampling_method_check
    CHECK (sampling_method IS NULL OR sampling_method IN ('random', 'stratified', 'exhaustive', 'ad_hoc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.normalize_company_label(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_catalog
AS $$
  SELECT regexp_replace(
    translate(
      lower(COALESCE(p_value, '')),
      'àáâäãåçèéêëìíîïñòóôöõùúûüýÿœæ',
      'aaaaaaceeeeiiiinooooouuuuyyoa'
    ),
    '[^a-z0-9]+', '', 'g'
  )
$$;

CREATE UNIQUE INDEX IF NOT EXISTS press_expected_matched_signal_unique
  ON public.press_expected_opportunities(matched_signal_id)
  WHERE matched_signal_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.snapshot_press_signal_review()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
BEGIN
  SELECT * INTO v_signal FROM public.signals WHERE id = NEW.signal_id;
  IF NOT FOUND OR v_signal.article_id IS NULL THEN
    RAISE EXCEPTION 'Seul un signal Presse relié à un article peut être revu' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.signal_id IS DISTINCT FROM OLD.signal_id THEN
    NEW.predicted_company_name := v_signal.company_name;
    NEW.predicted_signal_type := v_signal.signal_type;
    NEW.raw_article_id := v_signal.article_id;
    NEW.model_revision := v_signal.detection_model_revision;
    NEW.prompt_hash := v_signal.detection_prompt_hash;
  ELSE
    NEW.predicted_company_name := OLD.predicted_company_name;
    NEW.predicted_signal_type := OLD.predicted_signal_type;
    NEW.raw_article_id := OLD.raw_article_id;
    NEW.model_revision := OLD.model_revision;
    NEW.prompt_hash := OLD.prompt_hash;
  END IF;
  IF COALESCE(trim(NEW.dataset_version), '') = '' OR NEW.sampling_method IS NULL THEN
    RAISE EXCEPTION 'dataset_version et sampling_method sont obligatoires' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS snapshot_press_signal_review_before_write ON public.press_signal_quality_reviews;
CREATE TRIGGER snapshot_press_signal_review_before_write
  BEFORE INSERT OR UPDATE ON public.press_signal_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_press_signal_review();

CREATE OR REPLACE FUNCTION public.validate_press_expected_opportunity_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
BEGIN
  IF COALESCE(trim(NEW.dataset_version), '') = ''
     OR NEW.sampling_method IS NULL
     OR COALESCE(trim(NEW.model_revision), '') = ''
     OR COALESCE(trim(NEW.prompt_hash), '') = '' THEN
    RAISE EXCEPTION 'Révision, prompt, dataset et échantillonnage sont obligatoires' USING ERRCODE = '22023';
  END IF;
  IF NEW.matched_signal_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_signal FROM public.signals WHERE id = NEW.matched_signal_id;
  IF NOT FOUND
     OR v_signal.article_id IS DISTINCT FROM NEW.raw_article_id
     OR v_signal.signal_type IS DISTINCT FROM NEW.expected_signal_type
     OR public.normalize_company_label(v_signal.company_name)
        IS DISTINCT FROM public.normalize_company_label(NEW.expected_company_name) THEN
    RAISE EXCEPTION 'Le match doit avoir le même article, type et société normalisée' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

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
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_verdict NOT IN ('correct', 'incorrect', 'uncertain') THEN
    RAISE EXCEPTION 'Verdict invalide' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.press_signal_quality_reviews(
    signal_id, verdict, evidence, reviewed_by, reviewed_at, dataset_version, sampling_method
  ) VALUES (
    p_signal_id, p_verdict, COALESCE(p_evidence, '{}'::jsonb), auth.uid(), now(),
    p_dataset_version, p_sampling_method
  )
  ON CONFLICT (signal_id) DO UPDATE SET
    verdict = EXCLUDED.verdict,
    evidence = EXCLUDED.evidence,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    dataset_version = EXCLUDED.dataset_version,
    sampling_method = EXCLUDED.sampling_method
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
DECLARE v_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'gourrmet:press-review:' || p_raw_article_id::text || ':'
    || public.normalize_company_label(p_expected_company_name) || ':' || p_expected_signal_type,
    0
  ));
  SELECT id INTO v_id
  FROM public.press_expected_opportunities
  WHERE raw_article_id = p_raw_article_id
    AND public.normalize_company_label(expected_company_name)
        = public.normalize_company_label(p_expected_company_name)
    AND expected_signal_type = p_expected_signal_type
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.press_expected_opportunities
    SET matched_signal_id = p_matched_signal_id,
        model_revision = p_model_revision,
        prompt_hash = p_prompt_hash,
        dataset_version = p_dataset_version,
        sampling_method = p_sampling_method,
        evidence = COALESCE(p_evidence, '{}'::jsonb),
        reviewed_by = auth.uid(), reviewed_at = now()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.press_expected_opportunities(
      raw_article_id, expected_company_name, expected_signal_type, matched_signal_id,
      model_revision, prompt_hash, dataset_version, sampling_method,
      evidence, reviewed_by, reviewed_at
    ) VALUES (
      p_raw_article_id, p_expected_company_name, p_expected_signal_type, p_matched_signal_id,
      p_model_revision, p_prompt_hash, p_dataset_version, p_sampling_method,
      COALESCE(p_evidence, '{}'::jsonb), auth.uid(), now()
    ) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_press_signal(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_press_expected_opportunity(uuid, text, text, uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_press_signal(uuid, text, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.review_press_expected_opportunity(uuid, text, text, uuid, text, text, text, text, jsonb) TO authenticated, service_role;

DROP VIEW IF EXISTS public.press_detection_quality_metrics;
CREATE VIEW public.press_detection_quality_metrics
WITH (security_invoker = true)
AS
WITH precision_groups AS (
  SELECT review.model_revision, review.prompt_hash, review.dataset_version, review.sampling_method,
         count(*) FILTER (
           WHERE review.verdict IN ('correct', 'incorrect')
             AND signal.article_id = review.raw_article_id
             AND signal.signal_type = review.predicted_signal_type
             AND public.normalize_company_label(signal.company_name)
                 = public.normalize_company_label(review.predicted_company_name)
         )::numeric AS labelled_predictions,
         count(*) FILTER (
           WHERE review.verdict = 'correct'
             AND signal.article_id = review.raw_article_id
             AND signal.signal_type = review.predicted_signal_type
             AND public.normalize_company_label(signal.company_name)
                 = public.normalize_company_label(review.predicted_company_name)
         )::numeric AS correct_predictions,
         count(*) FILTER (WHERE review.verdict = 'uncertain')::numeric AS uncertain_predictions,
         count(*) FILTER (
           WHERE signal.id IS NULL OR signal.article_id IS DISTINCT FROM review.raw_article_id
             OR signal.signal_type IS DISTINCT FROM review.predicted_signal_type
             OR public.normalize_company_label(signal.company_name)
                IS DISTINCT FROM public.normalize_company_label(review.predicted_company_name)
         )::numeric AS invalidated_labels
  FROM public.press_signal_quality_reviews review
  LEFT JOIN public.signals signal ON signal.id = review.signal_id AND signal.article_id IS NOT NULL
  WHERE review.model_revision IS NOT NULL AND review.prompt_hash IS NOT NULL
    AND review.dataset_version IS NOT NULL AND review.sampling_method IS NOT NULL
  GROUP BY review.model_revision, review.prompt_hash, review.dataset_version, review.sampling_method
), recall_groups AS (
  SELECT expected.model_revision, expected.prompt_hash, expected.dataset_version, expected.sampling_method,
         count(*)::numeric AS expected_opportunities,
         count(*) FILTER (
           WHERE signal.id IS NOT NULL
             AND signal.article_id = expected.raw_article_id
             AND signal.signal_type = expected.expected_signal_type
             AND public.normalize_company_label(signal.company_name)
                 = public.normalize_company_label(expected.expected_company_name)
         )::numeric AS matched_opportunities
  FROM public.press_expected_opportunities expected
  LEFT JOIN public.signals signal ON signal.id = expected.matched_signal_id
  WHERE expected.model_revision IS NOT NULL AND expected.prompt_hash IS NOT NULL
    AND expected.dataset_version IS NOT NULL AND expected.sampling_method IS NOT NULL
  GROUP BY expected.model_revision, expected.prompt_hash, expected.dataset_version, expected.sampling_method
), combined AS (
  SELECT COALESCE(p.model_revision, r.model_revision) AS model_revision,
         COALESCE(p.prompt_hash, r.prompt_hash) AS prompt_hash,
         COALESCE(p.dataset_version, r.dataset_version) AS dataset_version,
         COALESCE(p.sampling_method, r.sampling_method) AS sampling_method,
         COALESCE(p.labelled_predictions, 0) AS labelled_predictions,
         COALESCE(p.correct_predictions, 0) AS correct_predictions,
         COALESCE(p.uncertain_predictions, 0) AS uncertain_predictions,
         COALESCE(p.invalidated_labels, 0) AS invalidated_labels,
         COALESCE(r.expected_opportunities, 0) AS expected_opportunities,
         COALESCE(r.matched_opportunities, 0) AS matched_opportunities
  FROM precision_groups p
  FULL JOIN recall_groups r USING (model_revision, prompt_hash, dataset_version, sampling_method)
)
SELECT now() AS measured_at, combined.*,
       round(correct_predictions / NULLIF(labelled_predictions, 0), 4) AS labelled_precision,
       round(matched_opportunities / NULLIF(expected_opportunities, 0), 4) AS labelled_recall,
       CASE WHEN labelled_predictions > 0 THEN round((
         correct_predictions / labelled_predictions + 3.8416 / (2 * labelled_predictions)
         - 1.96 * sqrt((correct_predictions / labelled_predictions * (1 - correct_predictions / labelled_predictions)
           + 3.8416 / (4 * labelled_predictions)) / labelled_predictions)
       ) / (1 + 3.8416 / labelled_predictions), 4) END AS precision_lower_95,
       CASE WHEN labelled_predictions > 0 THEN round((
         correct_predictions / labelled_predictions + 3.8416 / (2 * labelled_predictions)
         + 1.96 * sqrt((correct_predictions / labelled_predictions * (1 - correct_predictions / labelled_predictions)
           + 3.8416 / (4 * labelled_predictions)) / labelled_predictions)
       ) / (1 + 3.8416 / labelled_predictions), 4) END AS precision_upper_95,
       CASE WHEN expected_opportunities > 0 THEN round((
         matched_opportunities / expected_opportunities + 3.8416 / (2 * expected_opportunities)
         - 1.96 * sqrt((matched_opportunities / expected_opportunities * (1 - matched_opportunities / expected_opportunities)
           + 3.8416 / (4 * expected_opportunities)) / expected_opportunities)
       ) / (1 + 3.8416 / expected_opportunities), 4) END AS recall_lower_95,
       CASE WHEN expected_opportunities > 0 THEN round((
         matched_opportunities / expected_opportunities + 3.8416 / (2 * expected_opportunities)
         + 1.96 * sqrt((matched_opportunities / expected_opportunities * (1 - matched_opportunities / expected_opportunities)
           + 3.8416 / (4 * expected_opportunities)) / expected_opportunities)
       ) / (1 + 3.8416 / expected_opportunities), 4) END AS recall_upper_95
FROM combined;

REVOKE ALL ON public.press_detection_quality_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.press_detection_quality_metrics TO service_role;
COMMENT ON VIEW public.press_detection_quality_metrics IS
  'Précision/rappel labellisés par révision, prompt et dataset, avec intervalle de Wilson 95 %. Aucune extrapolation sans labels.';
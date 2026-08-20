-- Une cohorte de feedback ne doit déclencher qu'une seule analyse automatique.
-- La réponse fournisseur est mise en cache avant l'écriture de la charte afin
-- qu'un kill/retry rejoue la persistance, jamais le POST payant.
--
-- Machine d'état (une seule transition par appel, toujours fencée par le bail) :
--
--   reserved ─────────► dispatching ─────────► response_cached ─────► completed
--      │  (intention        │  (réponse             │ (charte écrite)
--      │   ledger durable)  │   fournisseur         │
--      │                    │   observée)           │
--      │ expiration         │ expiration            │
--      ▼ RÉCUPÉRABLE        ▼ AMBIGUË               ▼
--   reserved (attempt+1)  reconciliation_required  failed → reserved
--
-- `reserved` est le seul état où l'on sait qu'aucun POST n'a eu lieu : aucune
-- intention n'est encore durable dans le ledger, donc son expiration se rejoue
-- sans risque de double coût. Dès que l'intention est écrite, l'état passe à
-- `dispatching` et son expiration devient une ambiguïté fournisseur qui exige
-- une réconciliation humaine. C'est le seul découpage qui distingue « jamais
-- appelé » de « peut-être facturé ».
CREATE TABLE IF NOT EXISTS public.tonal_charter_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_key text NOT NULL UNIQUE,
  model text NOT NULL,
  feedback_ids uuid[] NOT NULL,
  feedback_count integer NOT NULL CHECK (feedback_count > 0),
  feedback_available integer NOT NULL CHECK (feedback_available >= feedback_count),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  status text NOT NULL,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_request_key text,
  response_payload jsonb,
  error_message text,
  reconciliation jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  reserved_at timestamptz,
  dispatched_at timestamptz,
  response_cached_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Colonnes ajoutées après la première version de cette migration : la version
-- initiale ne connaissait pas l'état `reserved`.
ALTER TABLE public.tonal_charter_analysis_runs
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
ALTER TABLE public.tonal_charter_analysis_runs
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- Le CHECK est nommé et rejoué explicitement : un CHECK inline de
-- `CREATE TABLE IF NOT EXISTS` ne serait jamais mis à jour sur une base qui a
-- déjà exécuté la version précédente de cette migration.
ALTER TABLE public.tonal_charter_analysis_runs
  DROP CONSTRAINT IF EXISTS tonal_charter_analysis_runs_status_check;
ALTER TABLE public.tonal_charter_analysis_runs
  DROP CONSTRAINT IF EXISTS tonal_charter_analysis_status_valid;
ALTER TABLE public.tonal_charter_analysis_runs
  ADD CONSTRAINT tonal_charter_analysis_status_valid CHECK (
    status IN (
      'reserved', 'dispatching', 'response_cached', 'completed', 'failed',
      'reconciliation_required', 'abandoned'
    )
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

COMMENT ON COLUMN public.tonal_charter_analysis_runs.status IS
  'reserved = bail pris, aucune intention ledger, aucun POST : expiration rejouable. '
  'dispatching = intention ledger durable, POST possible : expiration ambiguë. '
  'response_cached = réponse fournisseur observée et stockée.';

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

  -- Une cohorte neuve n'est que RÉSERVÉE : tant que l'intention ledger n'est
  -- pas durable, aucun POST n'a pu partir et l'expiration reste rejouable.
  IF NOT FOUND THEN
    INSERT INTO public.tonal_charter_analysis_runs (
      cohort_key, model, feedback_ids, feedback_count, feedback_available,
      attempt, status, lease_token, lease_expires_at, reserved_at
    ) VALUES (
      p_cohort_key, p_model, p_feedback_ids, cardinality(p_feedback_ids),
      p_feedback_available, 1, 'reserved', new_token,
      now() + make_interval(secs => p_lease_seconds), now()
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

  -- Réservation encore vivante ou dispatch en vol : personne d'autre n'entre.
  IF analysis.status IN ('reserved', 'dispatching') THEN
    IF analysis.lease_expires_at IS NOT NULL AND analysis.lease_expires_at > now() THEN
      RETURN jsonb_build_object(
        'state', 'active', 'run_id', analysis.id,
        'attempt', analysis.attempt, 'should_dispatch', false,
        'should_apply', false
      );
    END IF;

    -- Expiration d'un `dispatching` : l'intention est durable, le POST a pu
    -- partir et aucune réponse n'a été cachée. On ne rejoue jamais un appel
    -- potentiellement facturé sans arbitrage.
    IF analysis.status = 'dispatching' THEN
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

    -- Expiration d'un `reserved` : aucune intention durable, donc aucun coût
    -- possible. La tentative est incrémentée pour repartir sur une clé de
    -- requête fournisseur neuve, jamais pour réutiliser l'ancienne.
    UPDATE public.tonal_charter_analysis_runs
    SET status = 'reserved', attempt = attempt + 1,
        lease_token = new_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        provider_request_key = NULL, response_payload = NULL,
        response_cached_at = NULL, error_message = NULL,
        reserved_at = now(), dispatched_at = NULL,
        started_at = now(), completed_at = NULL, updated_at = now()
    WHERE id = analysis.id
    RETURNING * INTO analysis;
    RETURN jsonb_build_object(
      'state', analysis.status, 'run_id', analysis.id,
      'lease_token', new_token, 'attempt', analysis.attempt,
      'should_dispatch', true, 'should_apply', false
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
  SET status = 'reserved', attempt = attempt + 1,
      lease_token = new_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      provider_request_key = NULL, response_payload = NULL,
      response_cached_at = NULL, error_message = NULL,
      reserved_at = now(), dispatched_at = NULL,
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

-- Transition fencée `reserved -> dispatching`. Elle n'est appelée qu'une fois
-- l'intention ledger réellement durable : à partir de cet instant, une
-- expiration devient ambiguë au lieu d'être rejouable.
CREATE OR REPLACE FUNCTION public.begin_tonal_charter_dispatch(
  p_run_id uuid,
  p_lease_token uuid,
  p_provider_request_key text,
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
     OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'Clé de dispatch tonale invalide' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tonal_charter_analysis_runs
  SET status = 'dispatching',
      provider_request_key = p_provider_request_key,
      dispatched_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  WHERE id = p_run_id
    AND lease_token = p_lease_token
    AND status = 'reserved'
    AND lease_expires_at > now();
  RETURN FOUND;
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
    AND status IN ('reserved', 'dispatching', 'response_cached');
  RETURN FOUND;
END;
$$;

-- Le type de retour passe de boolean à jsonb (motif de refus explicite).
-- `CREATE OR REPLACE` ne sait pas changer un type de retour : la migration
-- resterait non rejouable sur une base ayant appliqué la version précédente.
DROP FUNCTION IF EXISTS public.complete_tonal_charter_analysis(
  uuid, uuid, jsonb, integer, numeric
);
CREATE OR REPLACE FUNCTION public.complete_tonal_charter_analysis(
  p_run_id uuid,
  p_lease_token uuid,
  p_charter_data jsonb,
  p_feedback_available integer,
  p_confidence_score numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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

  -- La charte n'est jamais appliquée tant que la consommation fournisseur
  -- reste `unconfirmed` : sinon une reprise afficherait une charte issue d'un
  -- appel réel avec un ledger à requests_count=0 / units=0, c'est-à-dire un
  -- coût réel présenté comme gratuit.
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
      updated_at = now();
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
$$;

-- Compte les feedbacks et décide du déclenchement dans la même transaction.
--
-- Le seuil est « au moins cinq feedbacks hors de la dernière cohorte analysée »
-- et non un modulo sur le total. Deux différences décisives :
--   - un modulo saute définitivement le seuil quand deux insertions
--     concurrentes font passer le total de 4 à 6 ;
--   - un critère par horodatage (`created_at > last_analysis_at`) perdrait
--     tout feedback arrivé PENDANT une analyse, puisque `last_analysis_at`
--     est écrit à la fin de celle-ci, après leur création.
-- La cohorte est la seule référence exacte de ce qui a réellement été analysé.
-- La déduplication des appels concurrents est assurée en aval par la claim.
CREATE OR REPLACE FUNCTION public.sync_tonal_charter_feedback_state(
  p_threshold integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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

  UPDATE public.tonal_charter
  SET corrections_count = total_count,
      updated_at = now();
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
$$;

-- Réinitialisation transactionnelle. L'UI n'a plus à orchestrer deux requêtes
-- dont la seconde peut échouer en laissant la charte et les feedbacks
-- incohérents. Les runs non terminaux sont fencés ici, dans la même
-- transaction que la purge.
--
-- Un run `reserved` n'a jamais rendu d'intention durable : il est abandonné.
-- Un run `dispatching`/`response_cached` a pu coûter : il part en
-- `reconciliation_required`, jamais en `abandoned`. On ne déclare pas
-- « aucun coût » sans preuve fournisseur.
CREATE OR REPLACE FUNCTION public.reset_tonal_charter()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
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

  DELETE FROM public.message_feedback;
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
      updated_at = now();
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
$$;

REVOKE ALL ON FUNCTION public.claim_tonal_charter_analysis(text,text,uuid[],integer,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_tonal_charter_dispatch(uuid,uuid,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cache_tonal_charter_analysis_response(uuid,uuid,text,jsonb,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_tonal_charter_analysis(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_tonal_charter_analysis(uuid,uuid,jsonb,integer,numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_tonal_charter_feedback_state(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_tonal_charter()
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_tonal_charter_analysis(text,text,uuid[],integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_tonal_charter_dispatch(uuid,uuid,text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cache_tonal_charter_analysis_response(uuid,uuid,text,jsonb,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_tonal_charter_analysis(uuid,uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_tonal_charter_analysis(uuid,uuid,jsonb,integer,numeric)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_tonal_charter_feedback_state(integer)
  TO service_role;
-- Seule RPC tonale appelée directement par l'interface : elle est donc ouverte
-- aux utilisateurs internes authentifiés, et à eux seuls.
GRANT EXECUTE ON FUNCTION public.reset_tonal_charter() TO service_role, authenticated;
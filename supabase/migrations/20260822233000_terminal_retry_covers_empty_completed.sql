-- UN « COMPLETED » SANS CONTACTS N'EST PAS UN SUCCÈS À PROTÉGER.
--
-- Constaté le 2026-08-22 au soir : la relance autorisée de 20 signaux
-- « tentés sans résultat » n'en a mis que 2 en file. Les 18 autres ont été
-- refusés `already_completed` — ALORS QUE `p_allow_terminal_retry` valait
-- true. La branche `completed` de `enqueue_enrichment_job_authorized`
-- retournait sans jamais consulter le paramètre : l'autorisation de retenter
-- un état terminal ne couvrait en réalité que les `failed`.
--
-- Or un job `completed` avec ZÉRO contact est précisément le motif que cette
-- plateforme a payé toute la semaine : « ça tourne, ça ne produit pas ». Le
-- protéger comme un succès revenait à rendre ces signaux À JAMAIS
-- irretentables — les personas élargis et la résolution améliorée du
-- 21-22/08 ne pouvaient jamais leur être appliqués.
--
-- LE PÉRIMÈTRE EXACT DE LA REPRISE, volontairement étroit :
--   1. `p_allow_terminal_retry = true` — l'autorisation explicite, comme
--      pour les failed ; les producteurs automatiques (enqueue_enrichment_job)
--      passent false et restent incapables de rouvrir quoi que ce soit ;
--   2. AUCUN contact pour le signal — un signal pourvu n'est jamais
--      redemandé : la dépense n'y achèterait rien ;
--   3. `contact_enrichment_retry_blocker` muet — le même garde d'ambiguïté
--      que pour les failed : on ne retente pas par-dessus une preuve douteuse.
--
-- L'historique n'est PAS réécrit : le job `completed` reste `completed` ;
-- le nouveau job porte `previous_job_id` vers lui, comme pour les failed.

CREATE OR REPLACE FUNCTION public.enqueue_enrichment_job_authorized(
  p_signal_id uuid,
  p_job_type text DEFAULT 'contacts',
  p_priority integer DEFAULT 5,
  p_cooldown_seconds integer DEFAULT 86400,
  p_allow_terminal_retry boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job public.enrichment_jobs%ROWTYPE;
  v_previous_job public.enrichment_jobs%ROWTYPE;
  v_previous_enrichment public.company_enrichment%ROWTYPE;
  v_has_previous_job boolean := false;
  v_retry_blocker text;
  v_terminal_retry_authorized boolean := false;
  v_job_id uuid := gen_random_uuid();
BEGIN
  IF p_signal_id IS NULL THEN
    RAISE EXCEPTION 'signal_id requis' USING ERRCODE = '22023';
  END IF;
  IF p_job_type NOT IN ('contacts', 'logo', 'company_info') THEN
    RAISE EXCEPTION 'job_type invalide: %', p_job_type USING ERRCODE = '22023';
  END IF;
  IF p_priority NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'priority hors limites: %', p_priority USING ERRCODE = '22023';
  END IF;
  IF p_cooldown_seconds NOT BETWEEN 0 AND 604800 THEN
    RAISE EXCEPTION 'cooldown hors limites: %', p_cooldown_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_signal_id::text || ':' || p_job_type, 0)
  );

  SELECT * INTO v_job
  FROM public.enrichment_jobs
  WHERE signal_id = p_signal_id
    AND job_type = p_job_type
    AND status IN ('pending', 'running')
  ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, queued_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'active',
      'job_id', v_job.id,
      'operation_generation', v_job.id,
      'status', v_job.status,
      'already_queued', true
    );
  END IF;

  IF p_job_type = 'contacts' THEN
    SELECT * INTO v_previous_job
    FROM public.enrichment_jobs
    WHERE signal_id = p_signal_id
      AND job_type = 'contacts'
      AND status IN ('completed', 'failed')
    ORDER BY COALESCE(finished_at, updated_at, queued_at) DESC, id DESC
    LIMIT 1;
    v_has_previous_job := FOUND;

    IF v_has_previous_job AND v_previous_job.status = 'completed' THEN
      -- LE CORRECTIF : un completed n'est intouchable QUE s'il a produit.
      -- Sans autorisation explicite, ou dès qu'un contact existe, le refus
      -- reste entier ; sinon la reprise suit le même pipeline que les failed.
      IF NOT p_allow_terminal_retry
         OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = p_signal_id) THEN
        RETURN jsonb_build_object(
          'state', 'already_completed',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'already_queued', false
        );
      END IF;
      v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
      IF v_retry_blocker IS NOT NULL THEN
        RETURN jsonb_build_object(
          'state', 'retry_blocked_uncertain',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'blocker', v_retry_blocker,
          'already_queued', false
        );
      END IF;
      v_terminal_retry_authorized := true;
    END IF;

    IF v_has_previous_job AND v_previous_job.status = 'failed' THEN
      IF p_cooldown_seconds > 0
         AND v_previous_job.finished_at >= now() - make_interval(secs => p_cooldown_seconds) THEN
        RETURN jsonb_build_object(
          'state', 'cooldown',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'already_queued', false
        );
      END IF;
      IF NOT p_allow_terminal_retry THEN
        RETURN jsonb_build_object(
          'state', 'retry_requires_explicit_authorization',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'already_queued', false
        );
      END IF;
      v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
      IF v_retry_blocker IS NOT NULL THEN
        RETURN jsonb_build_object(
          'state', 'retry_blocked_uncertain',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'blocker', v_retry_blocker,
          'already_queued', false
        );
      END IF;
      v_terminal_retry_authorized := true;
    END IF;

    -- Compatibilité des enrichissements antérieurs à la queue : leur absence
    -- de job n'est jamais assimilée à une première exécution.
    IF NOT v_has_previous_job THEN
      SELECT * INTO v_previous_enrichment
      FROM public.company_enrichment
      WHERE signal_id = p_signal_id
      FOR UPDATE;
      IF FOUND AND v_previous_enrichment.status = 'completed' THEN
        -- Même règle que pour les jobs : un héritage « completed » sans le
        -- moindre contact peut être repris sur autorisation explicite.
        IF NOT p_allow_terminal_retry
           OR EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = p_signal_id) THEN
          RETURN jsonb_build_object(
            'state', 'already_completed',
            'job_id', NULL,
            'status', 'completed',
            'already_queued', false
          );
        END IF;
        v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
        IF v_retry_blocker IS NOT NULL THEN
          RETURN jsonb_build_object(
            'state', 'retry_blocked_uncertain',
            'job_id', NULL,
            'status', 'completed',
            'blocker', v_retry_blocker,
            'already_queued', false
          );
        END IF;
        v_terminal_retry_authorized := true;
      ELSIF FOUND AND v_previous_enrichment.status = 'failed' THEN
        IF p_cooldown_seconds > 0
           AND v_previous_enrichment.updated_at >= now() - make_interval(secs => p_cooldown_seconds) THEN
          RETURN jsonb_build_object(
            'state', 'cooldown',
            'job_id', NULL,
            'status', 'failed',
            'already_queued', false
          );
        END IF;
        IF NOT p_allow_terminal_retry THEN
          RETURN jsonb_build_object(
            'state', 'retry_requires_explicit_authorization',
            'job_id', NULL,
            'status', 'failed',
            'already_queued', false
          );
        END IF;
        v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
        IF v_retry_blocker IS NOT NULL THEN
          RETURN jsonb_build_object(
            'state', 'retry_blocked_uncertain',
            'job_id', NULL,
            'status', 'failed',
            'blocker', v_retry_blocker,
            'already_queued', false
          );
        END IF;
        v_terminal_retry_authorized := true;
      ELSIF FOUND AND v_previous_enrichment.status NOT IN ('pending') THEN
        RETURN jsonb_build_object(
          'state', 'retry_blocked_uncertain',
          'job_id', NULL,
          'status', v_previous_enrichment.status,
          'blocker', 'legacy_enrichment_nonterminal',
          'already_queued', false
        );
      END IF;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.enrichment_jobs (
      id, signal_id, job_type, priority, status, result
    ) VALUES (
      v_job_id,
      p_signal_id,
      p_job_type,
      p_priority,
      'pending',
      jsonb_build_object(
        'operation_generation', v_job_id,
        'terminal_retry_authorized', v_terminal_retry_authorized,
        'previous_job_id', CASE
          WHEN v_terminal_retry_authorized THEN v_previous_job.id
          ELSE NULL
        END
      )
    )
    RETURNING * INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_job
    FROM public.enrichment_jobs
    WHERE signal_id = p_signal_id
      AND job_type = p_job_type
      AND status IN ('pending', 'running')
    LIMIT 1;
    IF NOT FOUND THEN RAISE; END IF;
    RETURN jsonb_build_object(
      'state', 'active',
      'job_id', v_job.id,
      'operation_generation', v_job.id,
      'status', v_job.status,
      'already_queued', true
    );
  END;

  RETURN jsonb_build_object(
    'state', 'enqueued',
    'job_id', v_job.id,
    'operation_generation', v_job.id,
    'terminal_retry_authorized', v_terminal_retry_authorized,
    'status', v_job.status,
    'already_queued', false
  );
END;
$$;

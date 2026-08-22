-- LA REPRISE DES COMPLETED VIDES PASSE PAR LE CHEMIN CANONIQUE.
--
-- Hier soir, la migration 20260822233000 a ouvert la branche « completed
-- vide » de enqueue_enrichment_job_authorized. Vérification end-to-end du
-- 22/08 à 16:45 : les 17 jobs enfilés par cette voie sont TOUS morts en aval
-- — « begin LinkedIn dispatch: nouvelle génération non autorisée ». La garde
-- de begin_enrichment_dispatch exige un historique terminal SUPERSEDÉ avant
-- d'accorder une nouvelle génération, et l'enfilage direct ne supersede rien.
-- Zéro contact produit : un job mort-né dépense un slot et ment sur l'état.
--
-- La leçon, la même que le matin même sur le quota : LE CONTRAT TESTAIT UN
-- MAILLON, PAS LA CHAÎNE. enqueue disait « enqueued » ; personne ne
-- demandait au dispatch s'il accepterait le job.
--
-- L'architecture existante avait déjà LA réponse : la reprise d'un signal à
-- historique terminal — failed OU completed — est le travail de
-- authorize_enrichment_regeneration (20260821200000), qui supersede les jobs,
-- remet la fiche en état, TRACE le motif (≥ 10 caractères) et enfile un job
-- réellement dispatchable. C'est le chemin des 19 signaux de lundi, éprouvé
-- en production et par le contrat 40.
--
-- Cette migration réduit donc enqueue à son rôle juste : sur un completed
-- vide autorisé, il n'enfile plus — il ORIENTE, par un état explicite
-- (`requires_regeneration_authorization`) portant le nom du chemin canonique.
-- Un refus qui explique vaut mieux qu'une file qui ment.

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
      -- Un completed VIDE est reprenable — mais PAS par ce chemin. Constaté
      -- le 22/08 au soir : 17 jobs enfilés ici sont morts en aval sur
      -- « nouvelle génération non autorisée » — begin_enrichment_dispatch
      -- refuse toute génération tant que l'historique terminal n'est pas
      -- supersedé, ce que seule authorize_enrichment_regeneration fait (avec
      -- motif tracé). Enfiler ici fabriquait des morts-nés : un demi-chemin
      -- est pire qu'un refus. On ORIENTE vers le chemin canonique.
      IF p_allow_terminal_retry
         AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = p_signal_id) THEN
        RETURN jsonb_build_object(
          'state', 'requires_regeneration_authorization',
          'job_id', v_previous_job.id,
          'status', v_previous_job.status,
          'already_queued', false,
          'hint', 'Reprise legitime (completed sans contacts) : appeler '
                  'public.authorize_enrichment_regeneration(signal_id, motif, acteur), '
                  'qui supersede l historique et enfile un job dispatchable.'
        );
      END IF;
      RETURN jsonb_build_object(
        'state', 'already_completed',
        'job_id', v_previous_job.id,
        'status', v_previous_job.status,
        'already_queued', false
      );
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
        -- Même orientation pour l'héritage : la fiche completed est un
        -- barrage de begin_enrichment_dispatch, que seule la régénération
        -- autorisée sait lever.
        IF p_allow_terminal_retry
           AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = p_signal_id) THEN
          RETURN jsonb_build_object(
            'state', 'requires_regeneration_authorization',
            'job_id', NULL,
            'status', 'completed',
            'already_queued', false,
            'hint', 'Reprise legitime (fiche completed sans contacts) : appeler '
                    'public.authorize_enrichment_regeneration(signal_id, motif, acteur).'
          );
        END IF;
        RETURN jsonb_build_object(
          'state', 'already_completed',
          'job_id', NULL,
          'status', 'completed',
          'already_queued', false
        );
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

-- Une ligne company_enrichment vit pendant toute la vie d'un signal, mais une
-- tentative fournisseur ne doit vivre que pendant un job. L'id du job devient
-- donc la génération durable : identique pendant les reclaims, différente
-- uniquement après un nouvel enqueue utilisateur explicitement autorisé.

-- Les runs déjà actifs ont été soumis avec les anciennes clés fondées sur
-- company_enrichment.id. Le cutover les marque explicitement comme génération
-- legacy afin que le poller les reprenne sans deviner ni resoumettre.
UPDATE public.company_enrichment AS enrichment
SET raw_data = (
      CASE WHEN jsonb_typeof(enrichment.raw_data) = 'object'
        THEN enrichment.raw_data ELSE '{}'::jsonb END
    ) || jsonb_build_object(
      'operation_generation', enrichment.id,
      'operation_generation_legacy', true
    )
WHERE enrichment.status IN (
    'processing', 'linkedin_processing', 'dropcontact_processing'
  )
  AND NULLIF(
    CASE WHEN jsonb_typeof(enrichment.raw_data) = 'object'
      THEN enrichment.raw_data->>'operation_generation' ELSE NULL END,
    ''
  ) IS NULL;

-- Même règle pour la route : si une génération legacy possède déjà un claim,
-- son provider vient de la preuve company_enrichment et non du setting actuel.
UPDATE public.enrichment_jobs AS job
SET result = COALESCE(job.result, '{}'::jsonb) || jsonb_build_object(
      'provider_route', enrichment.enrichment_source,
      'operation_generation', enrichment.raw_data->>'operation_generation',
      'route_bound_at', now(),
      'route_binding_source', 'legacy_company_enrichment'
    )
FROM public.company_enrichment AS enrichment
WHERE job.signal_id = enrichment.signal_id
  AND job.job_type = 'contacts'
  AND job.status IN ('pending', 'running')
  AND enrichment.enrichment_source IN ('linkedin', 'waterfall')
  AND enrichment.raw_data #>> '{queue_claim,job_id}' = job.id::text
  AND NULLIF(job.result->>'provider_route', '') IS NULL;

CREATE OR REPLACE FUNCTION public.contact_enrichment_retry_blocker(
  p_signal_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  enrichment public.company_enrichment%ROWTYPE;
  has_enrichment boolean := false;
BEGIN
  SELECT * INTO enrichment
  FROM public.company_enrichment
  WHERE signal_id = p_signal_id;
  has_enrichment := FOUND;

  IF EXISTS (
    SELECT 1
    FROM public.provider_usage_events usage
    WHERE usage.signal_id = p_signal_id
      AND usage.provider IN ('pappers', 'apify', 'dropcontact')
      AND usage.dispatch_status = 'unconfirmed'
  ) THEN
    RETURN 'provider_dispatch_unconfirmed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.pappers_credit_usage usage
    WHERE usage.details->>'signal_id' = p_signal_id::text
      AND usage.details->>'operation' = 'entreprise'
      AND usage.reservation_status IN ('reserved', 'uncertain')
  ) THEN
    RETURN 'pappers_outcome_uncertain';
  END IF;

  IF has_enrichment AND EXISTS (
    SELECT 1
    FROM public.provider_quota_reservations reservation
    WHERE reservation.provider = 'apify'
      AND reservation.run_id = enrichment.id
      AND reservation.status = 'reserved'
  ) THEN
    RETURN 'apify_outcome_uncertain';
  END IF;

  -- Dropcontact ne publie pas ici de preuve terminale d'échec. Tant qu'un lot
  -- accepté n'a pas produit la finalisation completed, une nouvelle génération
  -- pourrait doubler sa consommation, même si un catch local a écrit failed.
  IF has_enrichment
     AND enrichment.status <> 'completed'
     AND (
       NULLIF(enrichment.raw_data->>'dropcontact_request_id', '') IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.provider_usage_events usage
         WHERE usage.signal_id = p_signal_id
           AND usage.provider = 'dropcontact'
           AND usage.operation = 'enrich_submit'
           AND usage.success = true
           AND NULLIF(usage.metadata->>'provider_request_id', '') IS NOT NULL
       )
     )
  THEN
    RETURN 'dropcontact_task_nonterminal';
  END IF;

  -- Pour Apify, seuls les outcomes écrits par le poller après observation
  -- terminale autorisent une nouvelle génération. Un simple status=failed issu
  -- du catch du dispatcher n'est jamais une preuve de fin de run.
  IF has_enrichment
     AND enrichment.status <> 'completed'
     AND (
       NULLIF(enrichment.raw_data->>'apify_run_id', '') IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.provider_usage_events usage
         WHERE usage.signal_id = p_signal_id
           AND usage.provider = 'apify'
           AND usage.operation = 'linkedin_employee_submit'
           AND usage.success = true
           AND NULLIF(usage.metadata->>'provider_request_id', '') IS NOT NULL
       )
     )
     AND NOT (
       enrichment.status = 'failed'
       AND NULLIF(enrichment.raw_data->>'failed_at', '') IS NOT NULL
       AND (
         enrichment.raw_data->>'outcome' IN (
           'apify_failed',
           'apify_aborted',
           'apify_timed-out',
           'apify_timed_out',
           'apify_dataset_missing',
           'apify_dataset_fetch_error',
           'apify_dataset_proof_ambiguous',
           'operational_profiles_ambiguous',
           'no_operational_profiles'
         )
         OR enrichment.raw_data->>'outcome' LIKE 'dropcontact_%'
       )
     )
  THEN
    RETURN 'apify_task_nonterminal';
  END IF;

  RETURN NULL;
END;
$$;

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
    -- de job n'est jamais assimilée à une première exécution. Seul un failed
    -- explicite, sans aucune preuve ambiguë, peut recevoir une génération.
    IF NOT v_has_previous_job THEN
      SELECT * INTO v_previous_enrichment
      FROM public.company_enrichment
      WHERE signal_id = p_signal_id
      FOR UPDATE;
      IF FOUND AND v_previous_enrichment.status = 'completed' THEN
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

-- Tous les producteurs automatiques conservent l'ancien contrat et ne peuvent
-- pas créer une nouvelle génération après un échec terminal.
CREATE OR REPLACE FUNCTION public.enqueue_enrichment_job(
  p_signal_id uuid,
  p_job_type text DEFAULT 'contacts',
  p_priority integer DEFAULT 5,
  p_cooldown_seconds integer DEFAULT 86400
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH result AS (
    SELECT public.enqueue_enrichment_job_authorized(
      p_signal_id,
      p_job_type,
      p_priority,
      p_cooldown_seconds,
      false
    ) AS value
  )
  SELECT CASE
    WHEN value->>'state' = 'already_completed'
      THEN value || jsonb_build_object(
        'state', 'active',
        'reason', 'already_completed',
        'already_queued', true
      )
    WHEN value->>'state' IN (
        'retry_requires_explicit_authorization',
        'retry_blocked_uncertain'
      )
      THEN value || jsonb_build_object(
        'state', 'cooldown',
        'reason', COALESCE(value->>'blocker', 'explicit_retry_required')
      )
    ELSE value
  END
  FROM result;
$$;

-- Le setting choisit la route une seule fois. Tous les reclaims relisent ce
-- choix sur le job ; un changement de configuration ne peut donc pas faire
-- basculer une génération déjà engagée d'Apify vers waterfall (ou inversement).
CREATE OR REPLACE FUNCTION public.bind_enrichment_job_route(
  p_job_id uuid,
  p_lease_token uuid,
  p_requested_route text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  job public.enrichment_jobs%ROWTYPE;
  bound_route text;
BEGIN
  IF p_requested_route NOT IN ('linkedin', 'waterfall') THEN
    RAISE EXCEPTION 'route enrichissement invalide: %', p_requested_route
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO job
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bail enrichissement perdu avant routage'
      USING ERRCODE = '55000';
  END IF;

  bound_route := NULLIF(job.result->>'provider_route', '');
  IF bound_route IS NULL THEN
    bound_route := p_requested_route;
    UPDATE public.enrichment_jobs
    SET result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
      'provider_route', bound_route,
      'operation_generation', p_job_id,
      'route_bound_at', now()
    )
    WHERE id = p_job_id;
  ELSIF bound_route NOT IN ('linkedin', 'waterfall') THEN
    RAISE EXCEPTION 'route enrichissement persistée invalide: %', bound_route
      USING ERRCODE = '55000';
  END IF;

  RETURN bound_route;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_enrichment_dispatch(
  p_job_id uuid,
  p_lease_token uuid,
  p_signal_id uuid,
  p_company_name text,
  p_enrichment_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job public.enrichment_jobs%ROWTYPE;
  v_previous_job public.enrichment_jobs%ROWTYPE;
  v_enrichment_id uuid;
  v_existing_status text;
  v_existing_raw_data jsonb := '{}'::jsonb;
  v_claim_job_id text;
  v_operation_generation text;
  v_generation_started boolean := false;
  v_retry_blocker text;
  v_raw_data jsonb;
  v_bound_route text;
BEGIN
  IF p_enrichment_source NOT IN ('linkedin', 'waterfall') THEN
    RAISE EXCEPTION 'source dispatcher invalide: %', p_enrichment_source
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_company_name), '') IS NULL THEN
    RAISE EXCEPTION 'nom de société requis' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND signal_id = p_signal_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false);
  END IF;
  v_bound_route := NULLIF(v_job.result->>'provider_route', '');
  IF v_bound_route IS NULL OR v_bound_route <> p_enrichment_source THEN
    RAISE EXCEPTION 'route dispatcher non liée ou incohérente: % / %',
      COALESCE(v_bound_route, 'absente'), p_enrichment_source
      USING ERRCODE = '55000';
  END IF;

  SELECT id, status,
         CASE WHEN jsonb_typeof(raw_data) = 'object' THEN raw_data ELSE '{}'::jsonb END
  INTO v_enrichment_id, v_existing_status, v_existing_raw_data
  FROM public.company_enrichment
  WHERE signal_id = p_signal_id
  FOR UPDATE;

  IF FOUND AND v_existing_status = 'completed' THEN
    v_operation_generation := COALESCE(
      NULLIF(v_existing_raw_data->>'operation_generation', ''),
      v_enrichment_id::text
    );
    RETURN jsonb_build_object(
      'accepted', true,
      'already_completed', true,
      'enrichment_id', v_enrichment_id,
      'operation_generation', v_operation_generation,
      'generation_started', false,
      'raw_data', v_existing_raw_data
    );
  END IF;

  IF v_enrichment_id IS NULL THEN
    v_operation_generation := p_job_id::text;
    v_generation_started := true;
    v_raw_data := jsonb_build_object(
      'operation_generation', v_operation_generation,
      'operation_generation_legacy', false,
      'queue_claim', jsonb_build_object(
        'job_id', p_job_id,
        'lease_token', p_lease_token
      ),
      'dispatch_started_at', now()
    );
    INSERT INTO public.company_enrichment (
      signal_id,
      company_name,
      status,
      enrichment_source,
      resolution_attempted_at,
      resolution_technical_status,
      operational_profiles_count,
      raw_data
    ) VALUES (
      p_signal_id,
      p_company_name,
      'processing',
      p_enrichment_source,
      now(),
      NULL,
      0,
      v_raw_data
    )
    RETURNING id INTO v_enrichment_id;
  ELSE
    v_claim_job_id := NULLIF(v_existing_raw_data #>> '{queue_claim,job_id}', '');
    IF v_claim_job_id = p_job_id::text THEN
      -- Reclaim/retry interne : même génération et mêmes clés fournisseur.
      v_operation_generation := COALESCE(
        NULLIF(v_existing_raw_data->>'operation_generation', ''),
        v_enrichment_id::text
      );
      IF v_operation_generation NOT IN (p_job_id::text, v_enrichment_id::text) THEN
        RAISE EXCEPTION 'génération persistée incohérente: %', v_operation_generation
          USING ERRCODE = '55000';
      END IF;
      v_raw_data := v_existing_raw_data || jsonb_build_object(
        'operation_generation', v_operation_generation,
        'operation_generation_legacy', v_operation_generation = v_enrichment_id::text,
        'queue_claim', jsonb_build_object(
          'job_id', p_job_id,
          'lease_token', p_lease_token
        )
      );
    ELSE
      SELECT * INTO v_previous_job
      FROM public.enrichment_jobs
      WHERE signal_id = p_signal_id
        AND job_type = 'contacts'
        AND id <> p_job_id
        AND status IN ('completed', 'failed')
      ORDER BY COALESCE(finished_at, updated_at, queued_at) DESC, id DESC
      LIMIT 1;

      IF FOUND THEN
        IF v_previous_job.status <> 'failed'
           OR COALESCE((v_job.result->>'terminal_retry_authorized')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'nouvelle génération non autorisée'
            USING ERRCODE = '55000';
        END IF;
        v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
        IF v_retry_blocker IS NOT NULL THEN
          RAISE EXCEPTION 'nouvelle génération bloquée: %', v_retry_blocker
            USING ERRCODE = '55000';
        END IF;
      ELSIF v_existing_status = 'failed' THEN
        IF COALESCE((v_job.result->>'terminal_retry_authorized')::boolean, false) IS NOT TRUE THEN
          RAISE EXCEPTION 'nouvelle génération legacy non autorisée'
            USING ERRCODE = '55000';
        END IF;
        v_retry_blocker := public.contact_enrichment_retry_blocker(p_signal_id);
        IF v_retry_blocker IS NOT NULL THEN
          RAISE EXCEPTION 'nouvelle génération legacy bloquée: %', v_retry_blocker
            USING ERRCODE = '55000';
        END IF;
      ELSIF v_existing_status NOT IN ('pending') THEN
        RAISE EXCEPTION 'état legacy non terminal: %', v_existing_status
          USING ERRCODE = '55000';
      END IF;

      v_operation_generation := p_job_id::text;
      v_generation_started := true;
      v_raw_data := jsonb_build_object(
        'operation_generation', v_operation_generation,
        'operation_generation_legacy', false,
        'previous_generation', jsonb_strip_nulls(jsonb_build_object(
          'operation_generation', COALESCE(
            NULLIF(v_existing_raw_data->>'operation_generation', ''),
            v_enrichment_id::text
          ),
          'job_id', v_claim_job_id,
          'status', v_existing_status,
          'outcome', v_existing_raw_data->>'outcome',
          'failed_at', v_existing_raw_data->>'failed_at',
          'completed_at', v_existing_raw_data->>'completed_at'
        )),
        'queue_claim', jsonb_build_object(
          'job_id', p_job_id,
          'lease_token', p_lease_token
        ),
        'dispatch_started_at', now()
      );
    END IF;

    UPDATE public.company_enrichment
    SET status = 'processing',
        enrichment_source = p_enrichment_source,
        error_message = NULL,
        resolution_attempted_at = now(),
        resolution_technical_status = NULL,
        operational_profiles_count = 0,
        raw_data = v_raw_data
    WHERE id = v_enrichment_id;
  END IF;

  UPDATE public.signals
  SET enrichment_status = 'processing'
  WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal introuvable pour dispatcher' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'already_completed', false,
    'enrichment_id', v_enrichment_id,
    'operation_generation', v_operation_generation,
    'generation_started', v_generation_started,
    'raw_data', v_raw_data
  );
END;
$$;

REVOKE ALL ON FUNCTION public.contact_enrichment_retry_blocker(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_enrichment_job_authorized(uuid, text, integer, integer, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_enrichment_job_authorized(uuid, text, integer, integer, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.bind_enrichment_job_route(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_enrichment_job_route(uuid, uuid, text)
  TO service_role;

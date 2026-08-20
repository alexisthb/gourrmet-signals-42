-- Le rattrapage historique ne charge plus une liste PostgREST tronquée dans le
-- navigateur et ne lance plus un nombre illimité de requêtes Edge séquentielles.
-- Le comptage est exact côté base et chaque action enfile un lot borné.

CREATE OR REPLACE FUNCTION public.enrichment_batch_status(
  p_min_score integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pappers_enabled boolean;
  v_result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_min_score IS NULL OR p_min_score NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'p_min_score doit être compris entre 1 et 5'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    (SELECT value <> 'false'
     FROM public.settings
     WHERE key = 'pappers_enrichment_enabled'
     LIMIT 1),
    true
  ) INTO v_pappers_enabled;

  WITH candidates AS (
    SELECT
      signal.id,
      COALESCE(signal.enrichment_status, 'none') AS signal_status,
      COALESCE(signal.enrichment_status, 'none') IN ('none', 'pending')
        AND terminal.status IS NULL
        AND COALESCE(legacy_enrichment.status, 'pending') = 'pending'
        AS is_auto_eligible,
      EXISTS (
        SELECT 1
        FROM public.enrichment_jobs job
        WHERE job.signal_id = signal.id
          AND job.job_type = 'contacts'
          AND job.status IN ('pending', 'running')
      ) AS has_active_job,
      terminal.status AS terminal_status,
      terminal.finished_at AS terminal_finished_at,
      legacy_enrichment.status AS legacy_enrichment_status,
      legacy_enrichment.updated_at AS legacy_enrichment_updated_at
    FROM public.signals signal
    LEFT JOIN LATERAL (
      SELECT job.status, job.finished_at
      FROM public.enrichment_jobs job
      WHERE job.signal_id = signal.id
        AND job.job_type = 'contacts'
        AND job.status IN ('completed', 'failed')
      ORDER BY COALESCE(job.finished_at, job.updated_at, job.queued_at) DESC, job.id DESC
      LIMIT 1
    ) AS terminal ON true
    LEFT JOIN public.company_enrichment AS legacy_enrichment
      ON legacy_enrichment.signal_id = signal.id
    WHERE signal.score >= p_min_score
      AND (signal.source_name IS DISTINCT FROM 'Pappers' OR v_pappers_enabled)
      AND (
        COALESCE(signal.enrichment_status, 'none') IN ('none', 'pending', 'failed')
        OR EXISTS (
          SELECT 1
          FROM public.enrichment_jobs active_job
          WHERE active_job.signal_id = signal.id
            AND active_job.job_type = 'contacts'
            AND active_job.status IN ('pending', 'running')
        )
      )
  )
  SELECT jsonb_build_object(
    'total_count', count(*),
    'ready_count', count(*) FILTER (
      WHERE is_auto_eligible AND NOT has_active_job
    ),
    'active_count', count(*) FILTER (WHERE has_active_job),
    'cooldown_count', count(*) FILTER (
      WHERE (
          terminal_status = 'failed'
          OR (
            terminal_status IS NULL
            AND signal_status = 'failed'
            AND legacy_enrichment_status = 'failed'
          )
        )
        AND NOT has_active_job
        AND COALESCE(terminal_finished_at, legacy_enrichment_updated_at)
          >= now() - interval '24 hours'
    ),
    'manual_retry_required_count', count(*) FILTER (
      WHERE (
          terminal_status = 'failed'
          OR (
            terminal_status IS NULL
            AND signal_status = 'failed'
            AND legacy_enrichment_status = 'failed'
          )
        )
        AND NOT has_active_job
        AND (
          COALESCE(terminal_finished_at, legacy_enrichment_updated_at) IS NULL
          OR COALESCE(terminal_finished_at, legacy_enrichment_updated_at)
            < now() - interval '24 hours'
        )
    )
  )
  INTO v_result
  FROM candidates;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_eligible_enrichment_batch(
  p_min_score integer,
  p_batch_size integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pappers_enabled boolean;
  v_signal record;
  v_enqueue jsonb;
  v_enqueued integer := 0;
  v_already_active integer := 0;
  v_cooldown integer := 0;
  v_status jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_min_score IS NULL OR p_min_score NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'p_min_score doit être compris entre 1 et 5'
      USING ERRCODE = '22023';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 250 THEN
    RAISE EXCEPTION 'p_batch_size doit être compris entre 1 et 250'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    (SELECT value <> 'false'
     FROM public.settings
     WHERE key = 'pappers_enrichment_enabled'
     LIMIT 1),
    true
  ) INTO v_pappers_enabled;

  FOR v_signal IN
    SELECT signal.id
    FROM public.signals signal
    WHERE signal.score >= p_min_score
      AND COALESCE(signal.enrichment_status, 'none') IN ('none', 'pending')
      AND (signal.source_name IS DISTINCT FROM 'Pappers' OR v_pappers_enabled)
      AND NOT EXISTS (
        SELECT 1
        FROM public.enrichment_jobs job
        WHERE job.signal_id = signal.id
          AND job.job_type = 'contacts'
          AND job.status IN ('pending', 'running')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.enrichment_jobs job
        WHERE job.signal_id = signal.id
          AND job.job_type = 'contacts'
          AND job.status IN ('completed', 'failed')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.company_enrichment enrichment
        WHERE enrichment.signal_id = signal.id
          AND enrichment.status <> 'pending'
      )
    ORDER BY signal.score DESC, signal.detected_at ASC, signal.id
    LIMIT p_batch_size
  LOOP
    v_enqueue := public.enqueue_enrichment_job(
      v_signal.id,
      'contacts',
      5,
      86400
    );

    CASE v_enqueue->>'state'
      WHEN 'enqueued' THEN
        v_enqueued := v_enqueued + 1;
        UPDATE public.signals
        SET enrichment_status = 'pending'
        WHERE id = v_signal.id
          AND COALESCE(enrichment_status, 'none') IN ('none', 'pending', 'failed');
      WHEN 'active' THEN
        v_already_active := v_already_active + 1;
      WHEN 'cooldown' THEN
        v_cooldown := v_cooldown + 1;
      ELSE
        RAISE EXCEPTION 'Résultat enqueue inattendu: %', v_enqueue
          USING ERRCODE = 'P0001';
    END CASE;
  END LOOP;

  v_status := public.enrichment_batch_status(p_min_score);
  RETURN v_status || jsonb_build_object(
    'enqueued_count', v_enqueued,
    'already_active_count', v_already_active,
    'skipped_cooldown_count', v_cooldown,
    'batch_size', p_batch_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enrichment_batch_status(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enrichment_batch_status(integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_eligible_enrichment_batch(integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_eligible_enrichment_batch(integer, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.enrichment_batch_status(integer) IS
  'Comptage exact du backlog auto-enrichissement, distinct des jobs actifs et du cooldown.';
COMMENT ON FUNCTION public.enqueue_eligible_enrichment_batch(integer, integer) IS
  'Enfile atomiquement un lot borne de signaux eligibles sans dependance au plafond PostgREST.';

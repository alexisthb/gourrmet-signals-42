-- Queue d'enrichissement transactionnelle : un seul job actif par signal/type,
-- concurrence globale bornée et lease clôturable sans double consommation des
-- tentatives lorsqu'un worker disparaît.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.company_enrichment AS enrichment
    WHERE enrichment.status IN ('linkedin_processing', 'dropcontact_processing')
      AND NOT EXISTS (
        SELECT 1
        FROM public.enrichment_jobs AS job
        WHERE job.signal_id = enrichment.signal_id
          AND job.job_type = 'contacts'
          AND job.status = 'running'
      )
  ) THEN
    RAISE EXCEPTION
      'Cutover refusé: company_enrichment async sans job running; réconcilier le fournisseur avant 1710'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE public.enrichment_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS poll_token uuid,
  ADD COLUMN IF NOT EXISTS poll_expires_at timestamptz;

-- Les éventuels jobs déjà running au déploiement reçoivent un lease de
-- compatibilité. Le premier claim récupérera atomiquement ceux déjà expirés.
UPDATE public.enrichment_jobs
SET lease_owner = COALESCE(lease_owner, 'legacy-running-job'),
    lease_token = COALESCE(lease_token, gen_random_uuid()),
    lease_expires_at = COALESCE(
      lease_expires_at,
      COALESCE(started_at, updated_at, now()) + interval '45 minutes'
    )
WHERE status = 'running';

UPDATE public.enrichment_jobs
SET lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    poll_token = NULL,
    poll_expires_at = NULL
WHERE status <> 'running'
  AND (
    lease_owner IS NOT NULL OR lease_token IS NOT NULL OR lease_expires_at IS NOT NULL
    OR poll_token IS NOT NULL OR poll_expires_at IS NOT NULL
  );

-- Réconcilie les doublons historiques avant de poser l'unicité. On conserve
-- d'abord le running le plus ancien, puis le pending le plus prioritaire.
WITH ranked_active AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY signal_id, job_type
      ORDER BY
        CASE status WHEN 'running' THEN 0 ELSE 1 END,
        priority DESC,
        queued_at ASC,
        id
    ) AS active_rank
  FROM public.enrichment_jobs
  WHERE status IN ('pending', 'running')
)
UPDATE public.enrichment_jobs AS job
SET status = 'cancelled',
    finished_at = now(),
    next_retry_at = NULL,
    error_message = 'Duplicate active job reconciled by reliability migration',
    lease_owner = NULL,
    lease_token = NULL,
    lease_expires_at = NULL,
    poll_token = NULL,
    poll_expires_at = NULL
FROM ranked_active AS ranked
WHERE job.id = ranked.id
  AND ranked.active_rank > 1;

-- Relie les runs asynchrones déjà en cours à leur lease de compatibilité afin
-- que le poller déployé avec cette migration puisse les clôturer sans bypass.
UPDATE public.company_enrichment AS enrichment
SET raw_data = CASE
    WHEN jsonb_typeof(enrichment.raw_data) = 'object' THEN enrichment.raw_data
    ELSE '{}'::jsonb
  END || jsonb_build_object(
  'queue_claim', jsonb_build_object(
    'job_id', job.id,
    'lease_token', job.lease_token
  )
)
FROM public.enrichment_jobs AS job
WHERE job.signal_id = enrichment.signal_id
  AND job.job_type = 'contacts'
  AND job.status = 'running'
  AND enrichment.status IN ('linkedin_processing', 'dropcontact_processing');

CREATE UNIQUE INDEX IF NOT EXISTS enrichment_jobs_one_active_per_signal_type
  ON public.enrichment_jobs(signal_id, job_type)
  WHERE status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS enrichment_jobs_running_lease_expiry
  ON public.enrichment_jobs(lease_expires_at)
  WHERE status = 'running';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'enrichment_jobs_lease_state_check'
      AND conrelid = 'public.enrichment_jobs'::regclass
  ) THEN
    ALTER TABLE public.enrichment_jobs
      ADD CONSTRAINT enrichment_jobs_lease_state_check CHECK (
        (
          status = 'running'
          AND lease_token IS NOT NULL
          AND lease_expires_at IS NOT NULL
          AND (
            (poll_token IS NULL AND poll_expires_at IS NULL)
            OR (poll_token IS NOT NULL AND poll_expires_at IS NOT NULL)
          )
        )
        OR (
          status <> 'running'
          AND lease_owner IS NULL
          AND lease_token IS NULL
          AND lease_expires_at IS NULL
          AND poll_token IS NULL
          AND poll_expires_at IS NULL
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.clear_enrichment_job_lease_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.status <> 'running' THEN
    NEW.lease_owner := NULL;
    NEW.lease_token := NULL;
    NEW.lease_expires_at := NULL;
    NEW.poll_token := NULL;
    NEW.poll_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrichment_jobs_clear_lease
  ON public.enrichment_jobs;
CREATE TRIGGER trg_enrichment_jobs_clear_lease
  BEFORE INSERT OR UPDATE ON public.enrichment_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_enrichment_job_lease_on_terminal();

-- `signals.enrichment_status` est une projection transactionnelle du job
-- contacts actif/terminal. Un ancien terminal ne peut pas écraser un job actif
-- ni un job plus récent du même signal.
CREATE OR REPLACE FUNCTION public.sync_enrichment_job_signal_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal_status text;
BEGIN
  IF NEW.job_type <> 'contacts'
     OR NEW.status NOT IN ('pending', 'running', 'completed', 'failed') THEN
    RETURN NEW;
  END IF;

  v_signal_status := CASE NEW.status
    WHEN 'pending' THEN 'pending'
    WHEN 'running' THEN 'processing'
    WHEN 'completed' THEN 'completed'
    WHEN 'failed' THEN 'failed'
  END;

  IF NEW.status IN ('pending', 'running') THEN
    UPDATE public.signals
    SET enrichment_status = v_signal_status
    WHERE id = NEW.signal_id;
    RETURN NEW;
  END IF;

  UPDATE public.signals
  SET enrichment_status = v_signal_status
  WHERE id = NEW.signal_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.enrichment_jobs AS active
      WHERE active.signal_id = NEW.signal_id
        AND active.job_type = 'contacts'
        AND active.id <> NEW.id
        AND active.status IN ('pending', 'running')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.enrichment_jobs AS newer
      WHERE newer.signal_id = NEW.signal_id
        AND newer.job_type = 'contacts'
        AND newer.id <> NEW.id
        AND (
          newer.queued_at > NEW.queued_at
          OR (newer.queued_at = NEW.queued_at AND newer.id > NEW.id)
        )
    );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enrichment_jobs_sync_signal_status_insert
  ON public.enrichment_jobs;
CREATE TRIGGER trg_enrichment_jobs_sync_signal_status_insert
  AFTER INSERT ON public.enrichment_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_enrichment_job_signal_status();

DROP TRIGGER IF EXISTS trg_enrichment_jobs_sync_signal_status_update
  ON public.enrichment_jobs;
CREATE TRIGGER trg_enrichment_jobs_sync_signal_status_update
  AFTER UPDATE OF status ON public.enrichment_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_enrichment_job_signal_status();

-- Rattrape uniquement les signaux déjà annoncés en attente/en cours. Les
-- historiques `none` ne sont pas requalifiés à partir de vieux jobs.
WITH active AS (
  SELECT DISTINCT ON (signal_id)
    signal_id,
    CASE status WHEN 'running' THEN 'processing' ELSE 'pending' END AS signal_status
  FROM public.enrichment_jobs
  WHERE job_type = 'contacts'
    AND status IN ('pending', 'running')
  ORDER BY signal_id, CASE status WHEN 'running' THEN 0 ELSE 1 END, queued_at DESC
)
UPDATE public.signals AS signal
SET enrichment_status = active.signal_status
FROM active
WHERE signal.id = active.signal_id;

WITH latest_terminal AS (
  SELECT DISTINCT ON (job.signal_id)
    job.signal_id,
    job.status
  FROM public.enrichment_jobs AS job
  WHERE job.job_type = 'contacts'
    AND job.status IN ('completed', 'failed')
    AND NOT EXISTS (
      SELECT 1
      FROM public.enrichment_jobs AS active
      WHERE active.signal_id = job.signal_id
        AND active.job_type = 'contacts'
        AND active.status IN ('pending', 'running')
    )
  ORDER BY job.signal_id, job.queued_at DESC, job.id DESC
)
UPDATE public.signals AS signal
SET enrichment_status = latest_terminal.status
FROM latest_terminal
WHERE signal.id = latest_terminal.signal_id
  AND signal.enrichment_status IN ('pending', 'processing');

-- Enqueue atomique : le verrou métier couvre le check actif, le cooldown et
-- l'insert. L'index partiel reste la garantie ultime pour tous les autres
-- producteurs historiques de la table.
CREATE OR REPLACE FUNCTION public.enqueue_enrichment_job(
  p_signal_id uuid,
  p_job_type text DEFAULT 'contacts',
  p_priority integer DEFAULT 5,
  p_cooldown_seconds integer DEFAULT 86400
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job public.enrichment_jobs%ROWTYPE;
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
      'status', v_job.status,
      'already_queued', true
    );
  END IF;

  IF p_job_type = 'contacts' AND p_cooldown_seconds > 0 THEN
    SELECT * INTO v_job
    FROM public.enrichment_jobs
    WHERE signal_id = p_signal_id
      AND job_type = p_job_type
      AND status = 'failed'
      AND finished_at >= now() - make_interval(secs => p_cooldown_seconds)
    ORDER BY finished_at DESC
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'state', 'cooldown',
        'job_id', v_job.id,
        'status', v_job.status,
        'already_queued', false
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.enrichment_jobs (
      signal_id, job_type, priority, status
    ) VALUES (
      p_signal_id, p_job_type, p_priority, 'pending'
    )
    RETURNING * INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    -- Un producteur qui ne passe pas par ce RPC a pu gagner la course. La
    -- contrainte garantit qu'il n'existe qu'un seul job à retourner.
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
      'status', v_job.status,
      'already_queued', true
    );
  END;

  RETURN jsonb_build_object(
    'state', 'enqueued',
    'job_id', v_job.id,
    'status', v_job.status,
    'already_queued', false
  );
END;
$$;

-- Claim atomique sous le même verrou global que le comptage de concurrence.
-- Les leases expirés sont récupérés dans cette transaction, sans incrémenter
-- attempts une seconde fois : seule une nouvelle prise consomme une tentative.
DROP FUNCTION IF EXISTS public.dequeue_enrichment_job(text);
DROP FUNCTION IF EXISTS public.dequeue_enrichment_job(text, integer);
DROP FUNCTION IF EXISTS public.dequeue_enrichment_job(text, integer, integer);

CREATE FUNCTION public.dequeue_enrichment_job(
  p_worker_id text DEFAULT NULL,
  p_max_concurrency integer DEFAULT 8,
  p_lease_seconds integer DEFAULT 120
)
RETURNS public.enrichment_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job public.enrichment_jobs;
  v_running integer;
  v_lease_token uuid := gen_random_uuid();
BEGIN
  IF p_max_concurrency < 1 OR p_max_concurrency > 50 THEN
    RAISE EXCEPTION 'p_max_concurrency hors limites: %', p_max_concurrency
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'p_lease_seconds hors limites: %', p_lease_seconds
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('gourrmet:enrichment:global-slots', 0)
  );

  WITH expired AS (
    SELECT id, attempts, max_attempts
    FROM public.enrichment_jobs
    WHERE status = 'running'
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    FOR UPDATE
  )
  UPDATE public.enrichment_jobs AS job
  SET status = CASE
        WHEN expired.attempts < expired.max_attempts THEN 'pending'
        ELSE 'failed'
      END,
      started_at = CASE
        WHEN expired.attempts < expired.max_attempts THEN NULL
        ELSE job.started_at
      END,
      finished_at = CASE
        WHEN expired.attempts < expired.max_attempts THEN NULL
        ELSE now()
      END,
      next_retry_at = CASE
        WHEN expired.attempts < expired.max_attempts THEN now()
        ELSE NULL
      END,
      error_message = 'Worker lease expired before a terminal result',
      lease_owner = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      poll_token = NULL,
      poll_expires_at = NULL,
      result = COALESCE(job.result, '{}'::jsonb) || jsonb_build_object(
        'lease_recovered_at', now()
      )
  FROM expired
  WHERE job.id = expired.id;

  UPDATE public.enrichment_jobs
  SET status = 'failed',
      finished_at = now(),
      next_retry_at = NULL,
      error_message = COALESCE(
        error_message,
        'Maximum enrichment attempts reached before claim'
      )
  WHERE status = 'pending'
    AND attempts >= max_attempts;

  SELECT count(*) INTO v_running
  FROM public.enrichment_jobs
  WHERE status = 'running';

  IF v_running >= p_max_concurrency THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_job
  FROM public.enrichment_jobs
  WHERE status = 'pending'
    AND attempts < max_attempts
    AND (next_retry_at IS NULL OR next_retry_at <= now())
  ORDER BY priority DESC, queued_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.enrichment_jobs
  SET status = 'running',
      started_at = now(),
      finished_at = NULL,
      next_retry_at = NULL,
      attempts = attempts + 1,
      error_message = NULL,
      lease_owner = COALESCE(NULLIF(btrim(p_worker_id), ''), 'anonymous-worker'),
      lease_token = v_lease_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
        'worker_id', COALESCE(NULLIF(btrim(p_worker_id), ''), 'anonymous-worker'),
        'lease_token', v_lease_token
      )
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

-- Toute mutation effectuée pendant l'appel initial au fournisseur est liée au
-- lease courant. Un dispatcher dont l'appel HTTP revient après expiry/reclaim
-- ne peut donc ni écraser le run repris, ni écrire des contacts tardifs.
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
  v_enrichment_id uuid;
  v_existing_status text;
BEGIN
  IF p_enrichment_source NOT IN ('linkedin', 'waterfall') THEN
    RAISE EXCEPTION 'source dispatcher invalide: %', p_enrichment_source
      USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_company_name), '') IS NULL THEN
    RAISE EXCEPTION 'nom de société requis' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
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

  SELECT id, status INTO v_enrichment_id, v_existing_status
  FROM public.company_enrichment
  WHERE signal_id = p_signal_id
  FOR UPDATE;

  IF FOUND AND v_existing_status = 'completed' THEN
    RETURN jsonb_build_object(
      'accepted', true,
      'already_completed', true,
      'enrichment_id', v_enrichment_id
    );
  END IF;

  IF v_enrichment_id IS NULL THEN
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
      jsonb_build_object(
        'queue_claim', jsonb_build_object(
          'job_id', p_job_id,
          'lease_token', p_lease_token
        ),
        'dispatch_started_at', now()
      )
    )
    RETURNING id INTO v_enrichment_id;
  ELSE
    UPDATE public.company_enrichment
    SET status = 'processing',
        enrichment_source = p_enrichment_source,
        error_message = NULL,
        resolution_attempted_at = now(),
        resolution_technical_status = NULL,
        operational_profiles_count = 0,
        raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object(
          'queue_claim', jsonb_build_object(
            'job_id', p_job_id,
            'lease_token', p_lease_token
          ),
          'dispatch_started_at', now()
        )
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
    'enrichment_id', v_enrichment_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_enrichment_dispatch(
  p_job_id uuid,
  p_lease_token uuid,
  p_enrichment_id uuid,
  p_company_patch jsonb,
  p_signal_status text DEFAULT NULL,
  p_expected_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal_id uuid;
  v_updated integer;
BEGIN
  IF jsonb_typeof(COALESCE(p_company_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'company_patch doit être un objet JSON' USING ERRCODE = '22023';
  END IF;
  IF p_signal_status IS NOT NULL
     AND p_signal_status NOT IN ('pending', 'processing', 'completed', 'failed') THEN
    RAISE EXCEPTION 'statut signal invalide: %', p_signal_status
      USING ERRCODE = '22023';
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.company_enrichment
  SET status = CASE
        WHEN p_company_patch ? 'status' THEN p_company_patch ->> 'status'
        ELSE status
      END,
      enrichment_source = CASE
        WHEN p_company_patch ? 'enrichment_source'
          THEN p_company_patch ->> 'enrichment_source'
        ELSE enrichment_source
      END,
      website = CASE
        WHEN p_company_patch ? 'website' THEN p_company_patch ->> 'website'
        ELSE website
      END,
      industry = CASE
        WHEN p_company_patch ? 'industry' THEN p_company_patch ->> 'industry'
        ELSE industry
      END,
      linkedin_company_url = CASE
        WHEN p_company_patch ? 'linkedin_company_url'
          THEN p_company_patch ->> 'linkedin_company_url'
        ELSE linkedin_company_url
      END,
      error_message = CASE
        WHEN p_company_patch ? 'error_message'
          THEN NULLIF(left(p_company_patch ->> 'error_message', 300), '')
        ELSE error_message
      END,
      resolution_status = CASE
        WHEN p_company_patch ? 'resolution_status'
          THEN p_company_patch ->> 'resolution_status'
        ELSE resolution_status
      END,
      resolution_score = CASE
        WHEN p_company_patch ? 'resolution_score'
          THEN (p_company_patch ->> 'resolution_score')::numeric
        ELSE resolution_score
      END,
      resolution_provenance = CASE
        WHEN p_company_patch ? 'resolution_provenance'
          THEN p_company_patch -> 'resolution_provenance'
        ELSE resolution_provenance
      END,
      resolution_attempted_at = CASE
        WHEN p_company_patch ? 'resolution_attempted_at'
          THEN (p_company_patch ->> 'resolution_attempted_at')::timestamptz
        ELSE resolution_attempted_at
      END,
      resolution_technical_status = CASE
        WHEN p_company_patch ? 'resolution_technical_status'
          THEN p_company_patch ->> 'resolution_technical_status'
        ELSE resolution_technical_status
      END,
      operational_profiles_count = CASE
        WHEN p_company_patch ? 'operational_profiles_count'
          THEN (p_company_patch ->> 'operational_profiles_count')::integer
        ELSE operational_profiles_count
      END,
      contact_resolution_measured_at = CASE
        WHEN p_company_patch ? 'contact_resolution_measured_at'
          THEN (p_company_patch ->> 'contact_resolution_measured_at')::timestamptz
        ELSE contact_resolution_measured_at
      END,
      contact_candidates_resolved = CASE
        WHEN p_company_patch ? 'contact_candidates_resolved'
          THEN (p_company_patch ->> 'contact_candidates_resolved')::integer
        ELSE contact_candidates_resolved
      END,
      contact_candidates_ambiguous = CASE
        WHEN p_company_patch ? 'contact_candidates_ambiguous'
          THEN (p_company_patch ->> 'contact_candidates_ambiguous')::integer
        ELSE contact_candidates_ambiguous
      END,
      contact_candidates_rejected = CASE
        WHEN p_company_patch ? 'contact_candidates_rejected'
          THEN (p_company_patch ->> 'contact_candidates_rejected')::integer
        ELSE contact_candidates_rejected
      END,
      raw_data = CASE
        WHEN p_company_patch ? 'raw_data' THEN p_company_patch -> 'raw_data'
        ELSE raw_data
      END
  WHERE id = p_enrichment_id
    AND signal_id = v_signal_id
    AND (p_expected_status IS NULL OR status = p_expected_status);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RETURN false; END IF;

  IF p_signal_status IS NOT NULL THEN
    UPDATE public.signals
    SET enrichment_status = p_signal_status
    WHERE id = v_signal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'signal introuvable pour mutation dispatcher'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_enrichment_dispatch(
  p_job_id uuid,
  p_lease_token uuid,
  p_enrichment_id uuid,
  p_company_patch jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal_id uuid;
  v_contacts_inserted integer := 0;
  v_updated boolean;
BEGIN
  IF jsonb_typeof(COALESCE(p_contacts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'contacts doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  WITH candidates AS (
    SELECT DISTINCT ON (
      COALESCE(
        NULLIF(lower(candidate.linkedin_url), ''),
        lower(COALESCE(candidate.first_name, '')) || '|' || lower(COALESCE(candidate.last_name, ''))
      )
    ) candidate.*
    FROM jsonb_to_recordset(COALESCE(p_contacts, '[]'::jsonb)) AS candidate(
      full_name text,
      first_name text,
      last_name text,
      job_title text,
      department text,
      location text,
      email_principal text,
      email_alternatif text,
      phone text,
      linkedin_url text,
      is_priority_target boolean,
      priority_score integer,
      outreach_status text,
      resolution_status text,
      resolution_score numeric,
      resolution_provenance jsonb,
      email_verification_status text,
      email_verification_provider text,
      email_verification_qualification text,
      email_verification_confidence numeric,
      email_verified_at timestamptz,
      email_verification_provenance jsonb,
      raw_data jsonb
    )
    WHERE NULLIF(btrim(candidate.full_name), '') IS NOT NULL
    ORDER BY COALESCE(
      NULLIF(lower(candidate.linkedin_url), ''),
      lower(COALESCE(candidate.first_name, '')) || '|' || lower(COALESCE(candidate.last_name, ''))
    )
  )
  INSERT INTO public.contacts (
    enrichment_id, signal_id, full_name, first_name, last_name, job_title,
    department, location, email_principal, email_alternatif, phone,
    linkedin_url, is_priority_target, priority_score, outreach_status,
    resolution_status, resolution_score, resolution_provenance,
    email_verification_status, email_verification_provider,
    email_verification_qualification, email_verification_confidence,
    email_verified_at, email_verification_provenance, raw_data
  )
  SELECT
    p_enrichment_id, v_signal_id, candidate.full_name, candidate.first_name,
    candidate.last_name, candidate.job_title, candidate.department,
    candidate.location, candidate.email_principal, candidate.email_alternatif,
    candidate.phone, candidate.linkedin_url, candidate.is_priority_target,
    candidate.priority_score, COALESCE(candidate.outreach_status, 'new'),
    candidate.resolution_status, candidate.resolution_score,
    candidate.resolution_provenance, candidate.email_verification_status,
    candidate.email_verification_provider,
    candidate.email_verification_qualification,
    candidate.email_verification_confidence, candidate.email_verified_at,
    candidate.email_verification_provenance, candidate.raw_data
  FROM candidates AS candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.contacts AS existing
    WHERE existing.enrichment_id = p_enrichment_id
      AND (
        (
          candidate.linkedin_url IS NOT NULL
          AND lower(existing.linkedin_url) = lower(candidate.linkedin_url)
        )
        OR (
          candidate.linkedin_url IS NULL
          AND lower(COALESCE(existing.first_name, '')) = lower(COALESCE(candidate.first_name, ''))
          AND lower(COALESCE(existing.last_name, '')) = lower(COALESCE(candidate.last_name, ''))
        )
      )
  );
  GET DIAGNOSTICS v_contacts_inserted = ROW_COUNT;

  v_updated := public.update_enrichment_dispatch(
    p_job_id,
    p_lease_token,
    p_enrichment_id,
    COALESCE(p_company_patch, '{}'::jsonb) || jsonb_build_object(
      'status', 'completed',
      'enrichment_source', 'waterfall',
      'error_message', NULL
    ),
    'completed',
    NULL
  );
  IF NOT v_updated THEN
    RAISE EXCEPTION 'lease dispatcher perdu pendant la finalisation'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'contacts_inserted', v_contacts_inserted
  );
END;
$$;

-- Un seul tick du poller peut travailler un job donné. Le claim de poll
-- renouvelle aussi la lease principale; un token expiré ne peut pas renaître.
CREATE OR REPLACE FUNCTION public.claim_enrichment_job_poll(
  p_job_id uuid,
  p_lease_token uuid,
  p_poll_seconds integer DEFAULT 600,
  p_lease_seconds integer DEFAULT 2700
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_poll_token uuid := gen_random_uuid();
  v_claimed uuid;
BEGIN
  IF p_job_id IS NULL OR p_lease_token IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_poll_seconds < 30 OR p_poll_seconds > 900 THEN
    RAISE EXCEPTION 'p_poll_seconds hors limites: %', p_poll_seconds
      USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds < 30 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'p_lease_seconds hors limites: %', p_lease_seconds
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.enrichment_jobs
  SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      poll_token = v_poll_token,
      poll_expires_at = now() + make_interval(secs => p_poll_seconds)
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now()
    AND (poll_token IS NULL OR poll_expires_at <= now())
  RETURNING poll_token INTO v_claimed;
  RETURN v_claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_enrichment_job_poll(
  p_job_id uuid,
  p_lease_token uuid,
  p_poll_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.enrichment_jobs
  SET poll_token = NULL,
      poll_expires_at = NULL
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- Les états intermédiaires sont eux aussi conditionnés au poll claim courant.
-- Le verrou du job sérialise cette mutation avec un éventuel nouveau poller.
CREATE OR REPLACE FUNCTION public.update_linkedin_enrichment_poll(
  p_job_id uuid,
  p_lease_token uuid,
  p_poll_token uuid,
  p_enrichment_id uuid,
  p_expected_status text,
  p_new_status text DEFAULT NULL,
  p_resolution_attempted_at timestamptz DEFAULT NULL,
  p_operational_profiles_count integer DEFAULT NULL,
  p_contact_resolution_measured_at timestamptz DEFAULT NULL,
  p_contact_candidates_resolved integer DEFAULT NULL,
  p_contact_candidates_ambiguous integer DEFAULT NULL,
  p_contact_candidates_rejected integer DEFAULT NULL,
  p_raw_data jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal_id uuid;
  v_updated integer;
BEGIN
  IF p_operational_profiles_count < 0
     OR p_contact_candidates_resolved < 0
     OR p_contact_candidates_ambiguous < 0
     OR p_contact_candidates_rejected < 0 THEN
    RAISE EXCEPTION 'compteur de résolution invalide' USING ERRCODE = '22023';
  END IF;

  SELECT signal_id INTO v_signal_id
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.company_enrichment
  SET status = COALESCE(p_new_status, status),
      resolution_attempted_at = COALESCE(p_resolution_attempted_at, resolution_attempted_at),
      resolution_technical_status = NULL,
      operational_profiles_count = COALESCE(
        p_operational_profiles_count,
        operational_profiles_count
      ),
      contact_resolution_measured_at = COALESCE(
        p_contact_resolution_measured_at,
        contact_resolution_measured_at
      ),
      contact_candidates_resolved = COALESCE(
        p_contact_candidates_resolved,
        contact_candidates_resolved
      ),
      contact_candidates_ambiguous = COALESCE(
        p_contact_candidates_ambiguous,
        contact_candidates_ambiguous
      ),
      contact_candidates_rejected = COALESCE(
        p_contact_candidates_rejected,
        contact_candidates_rejected
      ),
      raw_data = COALESCE(p_raw_data, raw_data)
  WHERE id = p_enrichment_id
    AND signal_id = v_signal_id
    AND status = p_expected_status;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- La clôture des voies contacts asynchrones (LinkedIn et waterfall Dropcontact)
-- est une seule transaction : validation du fence, insert dédoublonné des
-- contacts, états entreprise/signal, puis job terminal. La source existante est
-- conservée ; aucun résultat tardif ne peut écrire avant de perdre son token.
CREATE OR REPLACE FUNCTION public.finalize_linkedin_enrichment_poll(
  p_job_id uuid,
  p_lease_token uuid,
  p_poll_token uuid,
  p_enrichment_id uuid,
  p_signal_id uuid,
  p_status text,
  p_resolution_attempted_at timestamptz,
  p_resolution_technical_status text,
  p_operational_profiles_count integer,
  p_company_raw_data jsonb,
  p_contacts jsonb DEFAULT '[]'::jsonb,
  p_result jsonb DEFAULT '{}'::jsonb,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_locked_job uuid;
  v_company_updated integer;
  v_contacts_inserted integer := 0;
BEGIN
  IF p_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'statut terminal invalide: %', p_status
      USING ERRCODE = '22023';
  END IF;
  IF p_resolution_technical_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'statut technique invalide: %', p_resolution_technical_status
      USING ERRCODE = '22023';
  END IF;
  IF p_operational_profiles_count < 0 THEN
    RAISE EXCEPTION 'compte profils opérationnels invalide'
      USING ERRCODE = '22023';
  END IF;
  IF p_job_id IS NULL OR p_lease_token IS NULL OR p_poll_token IS NULL
     OR p_enrichment_id IS NULL OR p_signal_id IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  SELECT id INTO v_locked_job
  FROM public.enrichment_jobs
  WHERE id = p_job_id
    AND signal_id = p_signal_id
    AND job_type = 'contacts'
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('accepted', false, 'contacts_inserted', 0);
  END IF;

  IF p_status = 'completed' AND jsonb_typeof(COALESCE(p_contacts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'contacts doit être un tableau JSON' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'completed' THEN
    WITH candidates AS (
      SELECT DISTINCT ON (
        COALESCE(
          NULLIF(lower(candidate.linkedin_url), ''),
          lower(COALESCE(candidate.first_name, '')) || '|' || lower(COALESCE(candidate.last_name, ''))
        )
      ) candidate.*
      FROM jsonb_to_recordset(COALESCE(p_contacts, '[]'::jsonb)) AS candidate(
        full_name text,
        first_name text,
        last_name text,
        job_title text,
        department text,
        location text,
        email_principal text,
        email_alternatif text,
        phone text,
        linkedin_url text,
        is_priority_target boolean,
        priority_score integer,
        outreach_status text,
        resolution_status text,
        resolution_score numeric,
        resolution_provenance jsonb,
        email_verification_status text,
        email_verification_provider text,
        email_verification_qualification text,
        email_verification_confidence numeric,
        email_verified_at timestamptz,
        email_verification_provenance jsonb,
        raw_data jsonb
      )
      WHERE NULLIF(btrim(candidate.full_name), '') IS NOT NULL
      ORDER BY COALESCE(
        NULLIF(lower(candidate.linkedin_url), ''),
        lower(COALESCE(candidate.first_name, '')) || '|' || lower(COALESCE(candidate.last_name, ''))
      )
    )
    INSERT INTO public.contacts (
      enrichment_id, signal_id, full_name, first_name, last_name, job_title,
      department, location, email_principal, email_alternatif, phone,
      linkedin_url, is_priority_target, priority_score, outreach_status,
      resolution_status, resolution_score, resolution_provenance,
      email_verification_status, email_verification_provider,
      email_verification_qualification, email_verification_confidence,
      email_verified_at, email_verification_provenance, raw_data
    )
    SELECT
      p_enrichment_id, p_signal_id, candidate.full_name, candidate.first_name,
      candidate.last_name, candidate.job_title, candidate.department,
      candidate.location, candidate.email_principal, candidate.email_alternatif,
      candidate.phone, candidate.linkedin_url, candidate.is_priority_target,
      candidate.priority_score, COALESCE(candidate.outreach_status, 'new'),
      candidate.resolution_status, candidate.resolution_score,
      candidate.resolution_provenance, candidate.email_verification_status,
      candidate.email_verification_provider,
      candidate.email_verification_qualification,
      candidate.email_verification_confidence, candidate.email_verified_at,
      candidate.email_verification_provenance, candidate.raw_data
    FROM candidates AS candidate
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.contacts AS existing
      WHERE existing.enrichment_id = p_enrichment_id
        AND (
          (
            candidate.linkedin_url IS NOT NULL
            AND lower(existing.linkedin_url) = lower(candidate.linkedin_url)
          )
          OR (
            candidate.linkedin_url IS NULL
            AND lower(COALESCE(existing.first_name, '')) = lower(COALESCE(candidate.first_name, ''))
            AND lower(COALESCE(existing.last_name, '')) = lower(COALESCE(candidate.last_name, ''))
          )
        )
    );
    GET DIAGNOSTICS v_contacts_inserted = ROW_COUNT;
  END IF;

  UPDATE public.company_enrichment
  SET status = p_status,
      error_message = CASE
        WHEN p_status = 'failed' THEN NULLIF(left(p_error_message, 300), '')
        ELSE NULL
      END,
      resolution_attempted_at = COALESCE(p_resolution_attempted_at, now()),
      resolution_technical_status = p_resolution_technical_status,
      operational_profiles_count = p_operational_profiles_count,
      raw_data = COALESCE(p_company_raw_data, '{}'::jsonb)
  WHERE id = p_enrichment_id
    AND signal_id = p_signal_id;
  GET DIAGNOSTICS v_company_updated = ROW_COUNT;
  IF v_company_updated <> 1 THEN
    RAISE EXCEPTION 'company_enrichment introuvable pour finalisation'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.signals
  SET enrichment_status = p_status
  WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal introuvable pour finalisation' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.enrichment_jobs
  SET status = p_status,
      finished_at = now(),
      next_retry_at = NULL,
      error_message = CASE
        WHEN p_status = 'failed' THEN NULLIF(left(p_error_message, 500), '')
        ELSE NULL
      END,
      result = COALESCE(result, '{}'::jsonb) || COALESCE(p_result, '{}'::jsonb)
  WHERE id = p_job_id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND poll_token = p_poll_token;

  RETURN jsonb_build_object(
    'accepted', true,
    'contacts_inserted', v_contacts_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_enrichment_job(
  uuid, text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_enrichment_job(
  uuid, text, integer, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.dequeue_enrichment_job(
  text, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dequeue_enrichment_job(
  text, integer, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.begin_enrichment_dispatch(
  uuid, uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_enrichment_dispatch(
  uuid, uuid, uuid, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.update_enrichment_dispatch(
  uuid, uuid, uuid, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_enrichment_dispatch(
  uuid, uuid, uuid, jsonb, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.complete_enrichment_dispatch(
  uuid, uuid, uuid, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_enrichment_dispatch(
  uuid, uuid, uuid, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.claim_enrichment_job_poll(
  uuid, uuid, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_enrichment_job_poll(
  uuid, uuid, integer, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.release_enrichment_job_poll(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_enrichment_job_poll(
  uuid, uuid, uuid
) TO service_role;

REVOKE ALL ON FUNCTION public.update_linkedin_enrichment_poll(
  uuid, uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz,
  integer, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_linkedin_enrichment_poll(
  uuid, uuid, uuid, uuid, text, text, timestamptz, integer, timestamptz,
  integer, integer, integer, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_linkedin_enrichment_poll(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, integer,
  jsonb, jsonb, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_linkedin_enrichment_poll(
  uuid, uuid, uuid, uuid, uuid, text, timestamptz, text, integer,
  jsonb, jsonb, jsonb, text
) TO service_role;

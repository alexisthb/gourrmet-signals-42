-- Continuation durable Pappers.
--
-- L'API de recherche Pappers ne publie ni clé d'idempotence ni route de
-- récupération d'une réponse. Le seul contrat sûr est donc :
--   1. préparer et journaliser une tentative avant l'appel ;
--   2. la marquer "dispatched" avant le fetch ;
--   3. mettre en cache la réponse et finaliser son coût dans une transaction ;
--   4. ne jamais resoumettre automatiquement une tentative restée dispatched.

ALTER TABLE public.pappers_scan_progress
  ADD COLUMN IF NOT EXISTS execution_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.pappers_request_cache (
  usage_id uuid PRIMARY KEY REFERENCES public.pappers_credit_usage(id) ON DELETE CASCADE,
  request_key text NOT NULL UNIQUE,
  scan_id uuid NOT NULL REFERENCES public.pappers_scan_progress(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  payload_items integer NOT NULL CHECK (payload_items >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pappers_request_cache_scan_idx
  ON public.pappers_request_cache(scan_id, created_at);

ALTER TABLE public.pappers_request_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pappers_request_cache_service_all ON public.pappers_request_cache;
CREATE POLICY pappers_request_cache_service_all ON public.pappers_request_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.pappers_request_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.pappers_request_cache TO service_role;

CREATE OR REPLACE FUNCTION public.pappers_execution_snapshot(p_query_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'captured_at', now(),
    'queries', coalesce((
      SELECT jsonb_agg(to_jsonb(query_row) ORDER BY query_row.created_at, query_row.id)
      FROM public.pappers_queries query_row
      WHERE CASE
        WHEN p_query_id IS NULL THEN query_row.is_active
        ELSE query_row.id = p_query_id
      END
    ), '[]'::jsonb),
    'settings', coalesce((
      SELECT jsonb_object_agg(setting.key, setting.value)
      FROM public.settings setting
      WHERE setting.key IN (
        'min_revenue_pappers',
        'min_employees_pappers',
        'pappers_anticipation_months'
      )
    ), '{}'::jsonb),
    'priority_regions', coalesce((
      SELECT jsonb_agg(DISTINCT region_name ORDER BY region_name)
      FROM public.geo_zones zone
      CROSS JOIN LATERAL unnest(coalesce(zone.regions, ARRAY[]::text[])) AS region_name
      WHERE zone.is_active
        AND zone.priority > 0
        AND zone.priority < 99
    ), '[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.pappers_execution_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pappers_execution_snapshot(uuid) TO service_role;

-- Les runs déjà actifs au moment du déploiement gardent leur identité et
-- reçoivent un snapshot avant toute récupération.
UPDATE public.pappers_scan_progress scan
SET execution_snapshot = public.pappers_execution_snapshot(scan.query_id)
WHERE scan.status IN ('pending', 'running', 'paused')
  AND scan.execution_snapshot = '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.pappers_scan_has_ambiguous_request(p_scan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pappers_credit_usage usage
    WHERE usage.scan_id = p_scan_id
      AND (
        usage.reservation_status = 'uncertain'
        OR (
          usage.reservation_status = 'reserved'
          AND coalesce(usage.details->>'dispatch_state', 'ambiguous') <> 'prepared'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.pappers_scan_has_ambiguous_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pappers_scan_has_ambiguous_request(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.start_pappers_scan(
  p_query_id uuid DEFAULT NULL,
  p_scan_type text DEFAULT 'all_queries',
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  active_scan public.pappers_scan_progress%ROWTYPE;
  blocked_scan public.pappers_scan_progress%ROWTYPE;
  new_scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
  snapshot jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;
  IF p_scan_type NOT IN ('query', 'all_queries') THEN
    RAISE EXCEPTION 'type de scan Pappers invalide: %', p_scan_type USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));

  SELECT scan.* INTO blocked_scan
  FROM public.pappers_scan_progress scan
  WHERE scan.status IN ('pending', 'running', 'paused')
    AND public.pappers_scan_has_ambiguous_request(scan.id)
  ORDER BY scan.created_at, scan.id
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.pappers_scan_progress
    SET status = 'paused',
        error_message = 'Réconciliation Pappers requise: une tentative payante est restée ambiguë',
        lease_token = NULL,
        lease_expires_at = NULL,
        heartbeat_at = now()
    WHERE id = blocked_scan.id;
    RETURN jsonb_build_object(
      'scan_id', blocked_scan.id,
      'status', 'reconciliation_required',
      'recovered', false
    );
  END IF;

  SELECT * INTO active_scan
  FROM public.pappers_scan_progress
  WHERE status IN ('pending', 'running', 'paused')
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF active_scan.status = 'paused' THEN
      RAISE EXCEPTION 'un scan Pappers est en pause' USING ERRCODE = '55000';
    END IF;
    IF active_scan.lease_expires_at IS NOT NULL AND active_scan.lease_expires_at > now() THEN
      RAISE EXCEPTION 'un scan Pappers est déjà actif' USING ERRCODE = '55000';
    END IF;

    snapshot := CASE
      WHEN active_scan.execution_snapshot = '{}'::jsonb
        THEN public.pappers_execution_snapshot(active_scan.query_id)
      ELSE active_scan.execution_snapshot
    END;
    UPDATE public.pappers_scan_progress
    SET status = 'pending',
        completed_at = NULL,
        error_message = NULL,
        heartbeat_at = now(),
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        lease_token = token,
        execution_snapshot = snapshot
    WHERE id = active_scan.id
    RETURNING * INTO active_scan;

    RETURN jsonb_build_object(
      'scan_id', active_scan.id,
      'lease_token', token,
      'status', 'pending',
      'query_id', active_scan.query_id,
      'lease_expires_at', active_scan.lease_expires_at,
      'recovered', true
    );
  END IF;

  snapshot := public.pappers_execution_snapshot(p_query_id);
  IF jsonb_array_length(snapshot->'queries') = 0 THEN
    RAISE EXCEPTION 'aucune requête Pappers active à exécuter' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pappers_scan_progress (
    query_id, scan_type, status, current_page, processed_results,
    heartbeat_at, lease_expires_at, lease_token, execution_snapshot
  ) VALUES (
    p_query_id, p_scan_type, 'pending', 0, 0,
    now(), now() + make_interval(secs => p_lease_seconds), token, snapshot
  )
  RETURNING * INTO new_scan;

  RETURN jsonb_build_object(
    'scan_id', new_scan.id,
    'lease_token', token,
    'status', new_scan.status,
    'lease_expires_at', new_scan.lease_expires_at,
    'recovered', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_pappers_scan(
  p_scan_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  claimed_token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;
  IF public.pappers_scan_has_ambiguous_request(scan.id) THEN
    RAISE EXCEPTION 'réconciliation Pappers requise' USING ERRCODE = '55000';
  END IF;
  IF scan.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'bail Pappers invalide ou remplacé' USING ERRCODE = '55000';
  END IF;
  IF scan.status NOT IN ('pending', 'running') THEN
    RAISE EXCEPTION 'run Pappers non réclamable: %', scan.status USING ERRCODE = '55000';
  END IF;
  IF scan.status = 'running' AND scan.lease_expires_at > now() THEN
    RAISE EXCEPTION 'run Pappers déjà réclamé par un worker actif' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'running',
      started_at = coalesce(started_at, now()),
      completed_at = NULL,
      error_message = NULL,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = claimed_token,
      execution_snapshot = CASE
        WHEN execution_snapshot = '{}'::jsonb THEN public.pappers_execution_snapshot(query_id)
        ELSE execution_snapshot
      END
  WHERE id = scan.id
  RETURNING * INTO scan;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', claimed_token,
    'status', 'running',
    'last_cursor', scan.last_cursor,
    'processed_results', scan.processed_results,
    'execution_snapshot', scan.execution_snapshot
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.resume_pappers_scan(
  p_scan_id uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;
  IF public.pappers_scan_has_ambiguous_request(scan.id) THEN
    RAISE EXCEPTION 'réconciliation Pappers requise avant reprise' USING ERRCODE = '55000';
  END IF;
  IF scan.status NOT IN ('paused', 'error') THEN
    RAISE EXCEPTION 'run Pappers non reprenable: %', scan.status USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.pappers_scan_progress
    WHERE id <> p_scan_id AND status IN ('pending', 'running', 'paused')
  ) THEN
    RAISE EXCEPTION 'un autre scan Pappers est déjà actif' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'pending',
      completed_at = NULL,
      error_message = NULL,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = token,
      execution_snapshot = CASE
        WHEN execution_snapshot = '{}'::jsonb THEN public.pappers_execution_snapshot(query_id)
        ELSE execution_snapshot
      END
  WHERE id = scan.id
  RETURNING * INTO scan;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', token,
    'status', 'pending',
    'query_id', scan.query_id,
    'lease_expires_at', scan.lease_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_pappers_scan(p_lease_seconds integer DEFAULT 300)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan
  FROM public.pappers_scan_progress
  WHERE status IN ('pending', 'running')
    AND (lease_expires_at IS NULL OR lease_expires_at <= now())
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'idle');
  END IF;

  IF public.pappers_scan_has_ambiguous_request(scan.id) THEN
    UPDATE public.pappers_scan_progress
    SET status = 'paused',
        error_message = 'Réconciliation Pappers requise: appel envoyé sans réponse durable',
        lease_token = NULL,
        lease_expires_at = NULL,
        heartbeat_at = now()
    WHERE id = scan.id;
    RETURN jsonb_build_object(
      'scan_id', scan.id,
      'status', 'reconciliation_required'
    );
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'pending',
      completed_at = NULL,
      error_message = NULL,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = token,
      execution_snapshot = CASE
        WHEN execution_snapshot = '{}'::jsonb THEN public.pappers_execution_snapshot(query_id)
        ELSE execution_snapshot
      END
  WHERE id = scan.id
  RETURNING * INTO scan;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', token,
    'query_id', scan.query_id,
    'status', 'pending',
    'recovered', true,
    'lease_expires_at', scan.lease_expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.handoff_pappers_scan(
  p_scan_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  token uuid := gen_random_uuid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;
  IF scan.status <> 'running' OR scan.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'handoff Pappers refusé: bail remplacé ou état %', scan.status USING ERRCODE = '55000';
  END IF;
  IF public.pappers_scan_has_ambiguous_request(scan.id) THEN
    RAISE EXCEPTION 'handoff Pappers refusé: réconciliation requise' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pappers_scan_progress
  SET status = 'pending',
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      lease_token = token
  WHERE id = scan.id;

  RETURN jsonb_build_object(
    'scan_id', scan.id,
    'lease_token', token,
    'query_id', scan.query_id,
    'status', 'pending',
    'lease_expires_at', now() + make_interval(secs => p_lease_seconds)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pappers_request_dispatched(
  p_usage_id uuid,
  p_request_key text,
  p_scan_id uuid,
  p_lease_token uuid,
  p_cursor jsonb,
  p_lease_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  usage public.pappers_credit_usage%ROWTYPE;
  scan public.pappers_scan_progress%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'durée de bail Pappers invalide: %', p_lease_seconds USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND OR scan.status <> 'running' OR scan.lease_token IS DISTINCT FROM p_lease_token THEN
    RAISE EXCEPTION 'dispatch Pappers refusé: bail remplacé' USING ERRCODE = '55000';
  END IF;
  IF scan.lease_expires_at IS NULL OR scan.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'dispatch Pappers refusé: bail expiré' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO usage
  FROM public.pappers_credit_usage
  WHERE id = p_usage_id AND request_key = p_request_key AND scan_id = p_scan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'réservation Pappers introuvable: %', p_request_key USING ERRCODE = 'P0002';
  END IF;
  IF usage.reservation_status <> 'reserved'
     OR coalesce(usage.details->>'dispatch_state', '') <> 'prepared' THEN
    RETURN false;
  END IF;

  UPDATE public.pappers_credit_usage
  SET details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
        'dispatch_state', 'dispatched',
        'dispatched_at', now(),
        'lease_token', p_lease_token
      )
  WHERE id = usage.id;

  UPDATE public.pappers_scan_progress
  SET last_cursor = (coalesce(p_cursor, '{}'::jsonb) || jsonb_build_object(
        'phase', 'dispatched',
        'request_key', p_request_key
      ))::text,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = scan.id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_pappers_search_request(
  p_usage_id uuid,
  p_request_key text,
  p_scan_id uuid,
  p_lease_token uuid,
  p_actual_credits numeric,
  p_items_count integer,
  p_http_status integer,
  p_attempted_at timestamptz,
  p_metadata jsonb,
  p_payload jsonb,
  p_cursor jsonb,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  scan public.pappers_scan_progress%ROWTYPE;
  usage public.pappers_credit_usage%ROWTYPE;
  completion jsonb;
  checkpoint_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Accès service requis' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload->'resultats') <> 'array' THEN
    RAISE EXCEPTION 'payload Pappers non cachable' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:runs', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:pappers:credits', 0));
  SELECT * INTO scan FROM public.pappers_scan_progress WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'run Pappers introuvable: %', p_scan_id USING ERRCODE = 'P0002';
  END IF;

  -- La réponse appartient à la tentative dispatchée, même si un utilisateur a
  -- mis le run en pause pendant le fetch. On persiste donc coût+payload selon
  -- le lease gravé sur la réservation ; seul l'avancement du cursor exige que
  -- le worker possède encore le bail courant.
  SELECT * INTO usage
  FROM public.pappers_credit_usage
  WHERE id = p_usage_id
    AND request_key = p_request_key
    AND scan_id = p_scan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'réservation Pappers introuvable: %', p_request_key USING ERRCODE = 'P0002';
  END IF;
  IF usage.reservation_status <> 'reserved'
     OR coalesce(usage.details->>'dispatch_state', '') <> 'dispatched'
     OR coalesce(usage.details->>'lease_token', '') <> p_lease_token::text THEN
    RAISE EXCEPTION 'finalisation Pappers refusée: tentative ou lease incohérent' USING ERRCODE = '55000';
  END IF;

  completion := public.complete_pappers_credits(
    p_usage_id => p_usage_id,
    p_request_key => p_request_key,
    p_actual_credits => p_actual_credits,
    p_items_count => p_items_count,
    p_success => true,
    p_http_status => p_http_status,
    p_error_code => NULL,
    p_attempted_at => p_attempted_at,
    p_metadata => coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'dispatch_state', 'completed',
      'response_cached', true
    )
  );

  INSERT INTO public.pappers_request_cache(
    usage_id, request_key, scan_id, payload, payload_items
  ) VALUES (
    p_usage_id, p_request_key, p_scan_id, p_payload, p_items_count
  );

  UPDATE public.pappers_scan_progress
  SET last_cursor = (coalesce(p_cursor, '{}'::jsonb) || jsonb_build_object(
        'phase', 'response_cached',
        'request_key', p_request_key
      ))::text,
      heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = scan.id
    AND status = 'running'
    AND lease_token = p_lease_token
    AND lease_expires_at > now();
  GET DIAGNOSTICS checkpoint_rows = ROW_COUNT;

  RETURN completion || jsonb_build_object(
    'response_cached', true,
    'checkpoint_advanced', checkpoint_rows > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_pappers_scan(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_pappers_scan(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resume_pappers_scan(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_pappers_scan(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_pappers_scan(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_pappers_request_dispatched(uuid, text, uuid, uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_pappers_search_request(
  uuid, text, uuid, uuid, numeric, integer, integer, timestamptz, jsonb, jsonb, jsonb, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.start_pappers_scan(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_pappers_scan(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.resume_pappers_scan(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_pappers_scan(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.handoff_pappers_scan(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_pappers_request_dispatched(uuid, text, uuid, uuid, jsonb, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_pappers_search_request(
  uuid, text, uuid, uuid, numeric, integer, integer, timestamptz, jsonb, jsonb, jsonb, integer
) TO service_role;

-- Le cron n'est jamais créé par la migration : à ce stade l'ancienne révision
-- de run-pappers-scan peut encore être servie et interpréter `recover` comme un
-- scan quotidien. L'installateur doit être appelé explicitement, seulement
-- après le déploiement des deux Edge compatibles (voir le runbook).
CREATE OR REPLACE FUNCTION public.configure_pappers_recovery_cron(p_enable boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  job record;
  removed_jobs integer := 0;
  scheduled_job_id bigint;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Accès service ou administrateur requis' USING ERRCODE = '42501';
  END IF;

  IF to_regclass('cron.job') IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_scheduled',
      'reason', 'pg_cron_unavailable',
      'enabled', false
    );
  END IF;

  FOR job IN
    SELECT jobid FROM cron.job WHERE jobname = 'pappers-recovery-every-minute'
  LOOP
    PERFORM cron.unschedule(job.jobid);
    removed_jobs := removed_jobs + 1;
  END LOOP;

  IF NOT coalesce(p_enable, false) THEN
    RETURN jsonb_build_object(
      'status', 'disabled',
      'enabled', false,
      'removed_jobs', removed_jobs
    );
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name IN ('service_role_key', 'email_queue_service_role_key')
      AND decrypted_secret <> ''
  ) THEN
    RETURN jsonb_build_object(
      'status', 'not_scheduled',
      'reason', 'vault_service_role_key_missing',
      'enabled', false,
      'removed_jobs', removed_jobs
    );
  END IF;

  IF to_regnamespace('net') IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc proc
    JOIN pg_catalog.pg_namespace ns ON ns.oid = proc.pronamespace
    WHERE ns.nspname = 'net' AND proc.proname = 'http_post'
  ) THEN
    RETURN jsonb_build_object(
      'status', 'not_scheduled',
      'reason', 'pg_net_unavailable',
      'enabled', false,
      'removed_jobs', removed_jobs
    );
  END IF;

  SELECT cron.schedule(
    'pappers-recovery-every-minute',
    '* * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/run-pappers-scan',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1), ''),
            NULLIF((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1), '')
          )
        ),
        body := '{"action":"recover"}'::jsonb,
        timeout_milliseconds := 10000
      )
    $job$
  ) INTO scheduled_job_id;

  RETURN jsonb_build_object(
    'status', 'scheduled',
    'enabled', true,
    'job_id', scheduled_job_id,
    'removed_jobs', removed_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.configure_pappers_recovery_cron(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_pappers_recovery_cron(boolean)
  TO service_role;

-- Garde-fou de cutover : une ancienne planification issue d'un essai ou d'une
-- exécution partielle est retirée, mais rien n'est activé automatiquement.
DO $$
DECLARE
  job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  FOR job IN
    SELECT jobid FROM cron.job WHERE jobname = 'pappers-recovery-every-minute'
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table OR undefined_function OR invalid_schema_name THEN
  RAISE NOTICE 'pg_cron indisponible: aucun cron recovery Pappers créé par cette migration';
END $$;
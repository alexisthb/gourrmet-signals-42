-- L'application est un outil interne. Une session Auth ne suffit plus : il faut qu'un rôle
-- ait été attribué explicitement dans user_roles. Les comptes déjà autorisés sont conservés ;
-- les nouvelles inscriptions ne reçoivent plus automatiquement accès aux données.
DROP TRIGGER IF EXISTS on_auth_user_created_role ON auth.users;

CREATE OR REPLACE FUNCTION public.is_internal_user(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id
  )
$$;
REVOKE ALL ON FUNCTION public.is_internal_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_user(uuid) TO authenticated, service_role;

-- Garde de cutover : aucun rôle historique n'est considéré comme une preuve
-- d'autorisation. Sur un déploiement groupé, le schéma reste applicable avec
-- une allowlist vide, mais aucun rôle/policy historique n'est alors modifié.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_access_allowlist
    WHERE enabled
      AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE NOTICE
      'Cutover différé: remplir internal_access_allowlist puis appeler apply_internal_access_cutover()';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.internal_access_allowlist allowlist
    LEFT JOIN auth.users account ON account.id = allowlist.user_id
    WHERE allowlist.enabled AND account.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cutover refusé: un compte allowlist est absent de auth.users'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.user_roles role
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.internal_access_allowlist allowlist
    WHERE allowlist.user_id = role.user_id
      AND allowlist.enabled
      AND allowlist.role = role.role
  );

  INSERT INTO public.user_roles(user_id, role)
  SELECT user_id, role
  FROM public.internal_access_allowlist
  WHERE enabled
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;

-- Remplace les policies génériques `USING (true)` destinées à anon/authenticated sur toutes
-- les tables métier RLS. Les policies service_role et les règles particulières user_roles
-- sont préservées. Tous les rôles internes gardent le même usage produit actuel.
DO $$
DECLARE
  target record;
  policy record;
  -- Ces tables portent des traces ou états produits par les moteurs. Les
  -- comptes internes peuvent les lire mais passent par une Edge Function/RPC
  -- contrôlée pour toute mutation, afin de préserver la valeur de preuve.
  read_only_tables text[] := ARRAY[
    'apify_credit_usage', 'cron_state', 'email_provider_events',
    'email_send_log', 'email_send_state', 'email_unsubscribe_tokens',
    'emails_sent', 'enrichment_jobs', 'internal_access_allowlist', 'linkedin_scan_progress',
    'manus_credit_usage', 'newsapi_usage', 'pappers_credit_usage',
    'pappers_scan_progress', 'pappers_signals', 'perplexity_usage',
    'provider_usage_events', 'raw_articles', 'scan_logs', 'scrap_sessions',
    'suppressed_emails'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.internal_access_allowlist
    WHERE enabled AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE NOTICE 'Policies internes différées: allowlist non initialisée';
    RETURN;
  END IF;

  FOR target IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND c.relname <> 'user_roles'
  LOOP
    FOR policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target.table_name
        AND roles && ARRAY['public', 'anon', 'authenticated']::name[]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy.policyname, target.table_name);
    END LOOP;

    EXECUTE format('DROP POLICY IF EXISTS internal_read ON public.%I', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS internal_insert ON public.%I', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS internal_update ON public.%I', target.table_name);
    EXECUTE format('DROP POLICY IF EXISTS internal_delete ON public.%I', target.table_name);

    EXECUTE format(
      'CREATE POLICY internal_read ON public.%I FOR SELECT TO authenticated USING (public.is_internal_user(auth.uid()))',
      target.table_name
    );
    IF NOT (target.table_name = ANY(read_only_tables)) THEN
      EXECUTE format(
        'CREATE POLICY internal_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_internal_user(auth.uid()))',
        target.table_name
      );
      EXECUTE format(
        'CREATE POLICY internal_update ON public.%I FOR UPDATE TO authenticated USING (public.is_internal_user(auth.uid())) WITH CHECK (public.is_internal_user(auth.uid()))',
        target.table_name
      );
      EXECUTE format(
        'CREATE POLICY internal_delete ON public.%I FOR DELETE TO authenticated USING (public.is_internal_user(auth.uid()))',
        target.table_name
      );
    END IF;
  END LOOP;
END $$;

-- Le schéma doit être déployé avant les Edge compatibles. Les crons qui peuvent
-- appeler une ancienne révision sont donc arrêtés ici et ne sont réactivés que
-- par `configure_gourrmet_runtime_crons(true)` après le cutover Edge complet.
DO $$
DECLARE
  job record;
BEGIN
  FOR job IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'enrichment-worker-tick',
      'cron-check-linkedin-enrich-tick',
      'auto-fetch-logos-tick',
      'cron-check-logos-tick',
      'scan-every-4-hours',
      'process-email-queue',
      'daily-pappers-anniversary-scan',
      'pappers-scan-every-12h'
    )
  LOOP
    PERFORM cron.unschedule(job.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table OR undefined_function THEN
  RAISE NOTICE 'pg_cron indisponible: aucun cron interne modifié';
END $$;

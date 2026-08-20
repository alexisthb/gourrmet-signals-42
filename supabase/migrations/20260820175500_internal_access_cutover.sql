-- Procédure rejouable de cutover. Elle permet d'appliquer toutes les migrations
-- sur un projet neuf sans versionner d'identifiant utilisateur, puis de
-- remplir l'allowlist en SQL live avant d'activer les policies internes.

CREATE OR REPLACE FUNCTION public.apply_internal_access_cutover()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  target record;
  policy record;
  removed_roles integer := 0;
  inserted_roles integer := 0;
  protected_tables integer := 0;
  read_only_tables text[] := ARRAY[
    'apify_credit_usage', 'cron_state', 'email_provider_events',
    'email_send_log', 'email_send_state', 'email_unsubscribe_tokens',
    'emails_sent', 'enrichment_jobs', 'internal_access_allowlist',
    'linkedin_scan_progress', 'manus_credit_usage', 'newsapi_usage',
    'pappers_credit_usage', 'pappers_scan_progress', 'pappers_signals',
    'perplexity_usage', 'press_expected_opportunities',
    'press_signal_quality_reviews', 'provider_cost_rates',
    'provider_measurement_state', 'provider_quota_reservations',
    'provider_usage_events', 'raw_articles', 'resolution_quality_reviews',
    'scan_logs', 'scrap_sessions', 'suppressed_emails'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.internal_access_allowlist
    WHERE enabled AND role IN ('admin', 'super_admin')
  ) THEN
    RAISE EXCEPTION
      'Cutover refusé: internal_access_allowlist doit contenir au moins un admin actif'
      USING ERRCODE = '55000';
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
  GET DIAGNOSTICS removed_roles = ROW_COUNT;

  INSERT INTO public.user_roles(user_id, role)
  SELECT user_id, role
  FROM public.internal_access_allowlist
  WHERE enabled
  ON CONFLICT (user_id, role) DO NOTHING;
  GET DIAGNOSTICS inserted_roles = ROW_COUNT;

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
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        policy.policyname,
        target.table_name
      );
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
    protected_tables := protected_tables + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', true,
    'removed_roles', removed_roles,
    'inserted_roles', inserted_roles,
    'protected_tables', protected_tables,
    'applied_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_internal_access_cutover()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_internal_access_cutover()
  TO service_role;

COMMENT ON FUNCTION public.apply_internal_access_cutover() IS
  'Applique les rôles et policies internes après initialisation explicite de internal_access_allowlist.';

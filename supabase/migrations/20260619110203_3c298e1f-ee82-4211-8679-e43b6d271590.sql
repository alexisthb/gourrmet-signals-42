
-- =========================================================================
-- 1) DROP public-role policies on tables (replaced with authenticated-only)
-- =========================================================================

-- Tables that already have authenticated-role equivalents: just drop the public one
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.apify_credit_usage;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.apify_plan_settings;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.detected_events;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.event_contacts;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.event_exhibitors;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.events;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.geo_zones;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.linkedin_scan_progress;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.linkedin_sources;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.manus_credit_usage;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.manus_plan_settings;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pappers_credit_usage;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pappers_plan_settings;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pappers_queries;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pappers_scan_progress;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.pappers_signals;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.partner_houses;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.partner_news;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.presentations;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.scrap_sessions;

-- salon_mariage_exposants: drop the "Anyone can ..." policies (auth equivalents exist)
DROP POLICY IF EXISTS "Anyone can delete salon exposants" ON public.salon_mariage_exposants;
DROP POLICY IF EXISTS "Anyone can insert salon exposants" ON public.salon_mariage_exposants;
DROP POLICY IF EXISTS "Anyone can read salon exposants" ON public.salon_mariage_exposants;
DROP POLICY IF EXISTS "Anyone can update salon exposants" ON public.salon_mariage_exposants;

-- contact_interactions: drop public, recreate authenticated
DROP POLICY IF EXISTS "Authenticated users can delete contact_interactions" ON public.contact_interactions;
DROP POLICY IF EXISTS "Authenticated users can insert contact_interactions" ON public.contact_interactions;
DROP POLICY IF EXISTS "Authenticated users can read contact_interactions" ON public.contact_interactions;
CREATE POLICY "Authenticated users can read contact_interactions" ON public.contact_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert contact_interactions" ON public.contact_interactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete contact_interactions" ON public.contact_interactions FOR DELETE TO authenticated USING (true);

-- signal_interactions: same
DROP POLICY IF EXISTS "Authenticated users can delete signal_interactions" ON public.signal_interactions;
DROP POLICY IF EXISTS "Authenticated users can insert signal_interactions" ON public.signal_interactions;
DROP POLICY IF EXISTS "Authenticated users can read signal_interactions" ON public.signal_interactions;
CREATE POLICY "Authenticated users can read signal_interactions" ON public.signal_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert signal_interactions" ON public.signal_interactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete signal_interactions" ON public.signal_interactions FOR DELETE TO authenticated USING (true);

-- generated_gifts
DROP POLICY IF EXISTS "Authenticated users can delete generated_gifts" ON public.generated_gifts;
DROP POLICY IF EXISTS "Authenticated users can insert generated_gifts" ON public.generated_gifts;
DROP POLICY IF EXISTS "Authenticated users can read generated_gifts" ON public.generated_gifts;
DROP POLICY IF EXISTS "Authenticated users can update generated_gifts" ON public.generated_gifts;
CREATE POLICY "Authenticated users can read generated_gifts" ON public.generated_gifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert generated_gifts" ON public.generated_gifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update generated_gifts" ON public.generated_gifts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete generated_gifts" ON public.generated_gifts FOR DELETE TO authenticated USING (true);

-- gift_templates
DROP POLICY IF EXISTS "Authenticated users can delete gift_templates" ON public.gift_templates;
DROP POLICY IF EXISTS "Authenticated users can insert gift_templates" ON public.gift_templates;
DROP POLICY IF EXISTS "Authenticated users can read gift_templates" ON public.gift_templates;
DROP POLICY IF EXISTS "Authenticated users can update gift_templates" ON public.gift_templates;
CREATE POLICY "Authenticated users can read gift_templates" ON public.gift_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert gift_templates" ON public.gift_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update gift_templates" ON public.gift_templates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete gift_templates" ON public.gift_templates FOR DELETE TO authenticated USING (true);

-- email_send_log: restrict service-role policies to the service_role grantee
DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log;
DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT TO service_role USING (true);
CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- email_send_state
DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
CREATE POLICY "Service role can manage send state" ON public.email_send_state FOR ALL TO service_role USING (true) WITH CHECK (true);

-- email_unsubscribe_tokens
DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT TO service_role USING (true);

-- suppressed_emails
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT TO service_role USING (true);

-- =========================================================================
-- 2) STORAGE: drop anon writes; restrict authenticated writes to TO authenticated
-- =========================================================================
DROP POLICY IF EXISTS "Allow deletes for anon" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates for anon" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads for anon" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated delete company-logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update company-logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload company-logos" ON storage.objects;
CREATE POLICY "Authenticated upload company-logos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'company-logos');
CREATE POLICY "Authenticated update company-logos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'company-logos') WITH CHECK (bucket_id = 'company-logos');
CREATE POLICY "Authenticated delete company-logos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Authenticated delete generated-gifts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update generated-gifts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload generated-gifts" ON storage.objects;
CREATE POLICY "Authenticated upload generated-gifts" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'generated-gifts');
CREATE POLICY "Authenticated update generated-gifts" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'generated-gifts') WITH CHECK (bucket_id = 'generated-gifts');
CREATE POLICY "Authenticated delete generated-gifts" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'generated-gifts');

DROP POLICY IF EXISTS "Authenticated delete gift-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update gift-templates" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload gift-templates" ON storage.objects;
CREATE POLICY "Authenticated upload gift-templates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'gift-templates');
CREATE POLICY "Authenticated update gift-templates" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'gift-templates') WITH CHECK (bucket_id = 'gift-templates');
CREATE POLICY "Authenticated delete gift-templates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'gift-templates');

-- Presentations bucket: also need authenticated write policies (currently only public read exists)
DROP POLICY IF EXISTS "Authenticated upload presentations" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update presentations" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete presentations" ON storage.objects;
CREATE POLICY "Authenticated upload presentations" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'presentations');
CREATE POLICY "Authenticated update presentations" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'presentations') WITH CHECK (bucket_id = 'presentations');
CREATE POLICY "Authenticated delete presentations" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'presentations');

-- =========================================================================
-- 3) Views: switch to security_invoker
-- =========================================================================
ALTER VIEW public.enrichment_queue_stats SET (security_invoker = true);
ALTER VIEW public.seed_data_count SET (security_invoker = true);
ALTER VIEW public.signals_grouped_by_company SET (security_invoker = true);
ALTER VIEW public.cron_state_live SET (security_invoker = true);

-- =========================================================================
-- 4) Functions: set search_path, revoke EXECUTE from anon/authenticated on internal ones
-- =========================================================================
ALTER FUNCTION public.update_pipeline_status_timestamp() SET search_path = public;
ALTER FUNCTION public.auto_transition_enriched() SET search_path = public;
ALTER FUNCTION public.auto_transition_sent_on_email() SET search_path = public;
ALTER FUNCTION public.touch_enrichment_jobs_updated_at() SET search_path = public;
ALTER FUNCTION public.dequeue_enrichment_job(text) SET search_path = public;
ALTER FUNCTION public.compute_next_cron_run(text, timestamptz) SET search_path = public;
ALTER FUNCTION public.find_company_dupes(text, real) SET search_path = public;
ALTER FUNCTION public.immutable_unaccent(text) SET search_path = public;
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- Revoke EXECUTE from anon/authenticated on internal SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wipe_seed_data() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_state_run_start(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cron_state_run_end(text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_role() FROM PUBLIC, anon, authenticated;

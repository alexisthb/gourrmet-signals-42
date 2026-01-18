-- Add RLS policies for all tables - authenticated users with any role can access
-- Using a simple approach: all authenticated users can read/write all data

-- Signals table
CREATE POLICY "Authenticated users can read signals" ON public.signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert signals" ON public.signals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update signals" ON public.signals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete signals" ON public.signals FOR DELETE TO authenticated USING (true);

-- Contacts table
CREATE POLICY "Authenticated users can read contacts" ON public.contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert contacts" ON public.contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update contacts" ON public.contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete contacts" ON public.contacts FOR DELETE TO authenticated USING (true);

-- Settings table
CREATE POLICY "Authenticated users can read settings" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert settings" ON public.settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update settings" ON public.settings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete settings" ON public.settings FOR DELETE TO authenticated USING (true);

-- Events table
CREATE POLICY "Authenticated users can read events" ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert events" ON public.events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update events" ON public.events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete events" ON public.events FOR DELETE TO authenticated USING (true);

-- Event contacts table
CREATE POLICY "Authenticated users can read event_contacts" ON public.event_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert event_contacts" ON public.event_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update event_contacts" ON public.event_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete event_contacts" ON public.event_contacts FOR DELETE TO authenticated USING (true);

-- Event exhibitors table
CREATE POLICY "Authenticated users can read event_exhibitors" ON public.event_exhibitors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert event_exhibitors" ON public.event_exhibitors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update event_exhibitors" ON public.event_exhibitors FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete event_exhibitors" ON public.event_exhibitors FOR DELETE TO authenticated USING (true);

-- Geo zones table
CREATE POLICY "Authenticated users can read geo_zones" ON public.geo_zones FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert geo_zones" ON public.geo_zones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update geo_zones" ON public.geo_zones FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete geo_zones" ON public.geo_zones FOR DELETE TO authenticated USING (true);

-- LinkedIn tables
CREATE POLICY "Authenticated users can read linkedin_sources" ON public.linkedin_sources FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert linkedin_sources" ON public.linkedin_sources FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update linkedin_sources" ON public.linkedin_sources FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete linkedin_sources" ON public.linkedin_sources FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read linkedin_posts" ON public.linkedin_posts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert linkedin_posts" ON public.linkedin_posts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update linkedin_posts" ON public.linkedin_posts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete linkedin_posts" ON public.linkedin_posts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read linkedin_engagers" ON public.linkedin_engagers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert linkedin_engagers" ON public.linkedin_engagers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update linkedin_engagers" ON public.linkedin_engagers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete linkedin_engagers" ON public.linkedin_engagers FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read linkedin_scan_progress" ON public.linkedin_scan_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert linkedin_scan_progress" ON public.linkedin_scan_progress FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update linkedin_scan_progress" ON public.linkedin_scan_progress FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete linkedin_scan_progress" ON public.linkedin_scan_progress FOR DELETE TO authenticated USING (true);

-- Pappers tables
CREATE POLICY "Authenticated users can read pappers_signals" ON public.pappers_signals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pappers_signals" ON public.pappers_signals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pappers_signals" ON public.pappers_signals FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pappers_signals" ON public.pappers_signals FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pappers_queries" ON public.pappers_queries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pappers_queries" ON public.pappers_queries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pappers_queries" ON public.pappers_queries FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pappers_queries" ON public.pappers_queries FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pappers_scan_progress" ON public.pappers_scan_progress FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pappers_scan_progress" ON public.pappers_scan_progress FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pappers_scan_progress" ON public.pappers_scan_progress FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pappers_scan_progress" ON public.pappers_scan_progress FOR DELETE TO authenticated USING (true);

-- Credit usage tables
CREATE POLICY "Authenticated users can read pappers_credit_usage" ON public.pappers_credit_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pappers_credit_usage" ON public.pappers_credit_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pappers_credit_usage" ON public.pappers_credit_usage FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read pappers_plan_settings" ON public.pappers_plan_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pappers_plan_settings" ON public.pappers_plan_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pappers_plan_settings" ON public.pappers_plan_settings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read apify_credit_usage" ON public.apify_credit_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert apify_credit_usage" ON public.apify_credit_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update apify_credit_usage" ON public.apify_credit_usage FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read apify_plan_settings" ON public.apify_plan_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert apify_plan_settings" ON public.apify_plan_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update apify_plan_settings" ON public.apify_plan_settings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read manus_credit_usage" ON public.manus_credit_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert manus_credit_usage" ON public.manus_credit_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update manus_credit_usage" ON public.manus_credit_usage FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read manus_plan_settings" ON public.manus_plan_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert manus_plan_settings" ON public.manus_plan_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update manus_plan_settings" ON public.manus_plan_settings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read newsapi_usage" ON public.newsapi_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert newsapi_usage" ON public.newsapi_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update newsapi_usage" ON public.newsapi_usage FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read newsapi_plan_settings" ON public.newsapi_plan_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert newsapi_plan_settings" ON public.newsapi_plan_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update newsapi_plan_settings" ON public.newsapi_plan_settings FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read perplexity_usage" ON public.perplexity_usage FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert perplexity_usage" ON public.perplexity_usage FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update perplexity_usage" ON public.perplexity_usage FOR UPDATE TO authenticated USING (true);

-- Other tables
CREATE POLICY "Authenticated users can read raw_articles" ON public.raw_articles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert raw_articles" ON public.raw_articles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update raw_articles" ON public.raw_articles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete raw_articles" ON public.raw_articles FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read search_queries" ON public.search_queries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert search_queries" ON public.search_queries FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update search_queries" ON public.search_queries FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete search_queries" ON public.search_queries FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read scan_logs" ON public.scan_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert scan_logs" ON public.scan_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update scan_logs" ON public.scan_logs FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read company_enrichment" ON public.company_enrichment FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert company_enrichment" ON public.company_enrichment FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update company_enrichment" ON public.company_enrichment FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read detected_events" ON public.detected_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert detected_events" ON public.detected_events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update detected_events" ON public.detected_events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete detected_events" ON public.detected_events FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read scrap_sessions" ON public.scrap_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert scrap_sessions" ON public.scrap_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update scrap_sessions" ON public.scrap_sessions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read partner_houses" ON public.partner_houses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert partner_houses" ON public.partner_houses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update partner_houses" ON public.partner_houses FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete partner_houses" ON public.partner_houses FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read partner_news" ON public.partner_news FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert partner_news" ON public.partner_news FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update partner_news" ON public.partner_news FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete partner_news" ON public.partner_news FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read presentations" ON public.presentations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert presentations" ON public.presentations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update presentations" ON public.presentations FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete presentations" ON public.presentations FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read salon_mariage_exposants" ON public.salon_mariage_exposants FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert salon_mariage_exposants" ON public.salon_mariage_exposants FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update salon_mariage_exposants" ON public.salon_mariage_exposants FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete salon_mariage_exposants" ON public.salon_mariage_exposants FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read tonal_charter" ON public.tonal_charter FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert tonal_charter" ON public.tonal_charter FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update tonal_charter" ON public.tonal_charter FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can read message_feedback" ON public.message_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert message_feedback" ON public.message_feedback FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update message_feedback" ON public.message_feedback FOR UPDATE TO authenticated USING (true);
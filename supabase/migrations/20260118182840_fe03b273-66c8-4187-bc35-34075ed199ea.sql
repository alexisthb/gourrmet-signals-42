-- =============================================
-- SECURITY FIX: Remove anonymous access from all tables
-- This is a single-tenant internal business tool
-- Only authenticated users should have access
-- =============================================

-- 1. Drop all anonymous user policies (the security vulnerability)

-- contacts table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.contacts;

-- signals table  
DROP POLICY IF EXISTS "Allow all for anon users" ON public.signals;

-- settings table (contains API keys!)
DROP POLICY IF EXISTS "Allow all for anon users" ON public.settings;

-- raw_articles table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.raw_articles;

-- search_queries table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.search_queries;

-- scan_logs table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.scan_logs;

-- company_enrichment table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.company_enrichment;

-- linkedin_sources table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.linkedin_sources;

-- linkedin_posts table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.linkedin_posts;

-- linkedin_engagers table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.linkedin_engagers;

-- linkedin_scan_progress table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.linkedin_scan_progress;

-- events table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.events;

-- event_contacts table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.event_contacts;

-- event_exhibitors table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.event_exhibitors;

-- detected_events table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.detected_events;

-- scrap_sessions table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.scrap_sessions;

-- geo_zones table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.geo_zones;

-- partner_houses table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.partner_houses;

-- partner_news table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.partner_news;

-- presentations table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.presentations;

-- message_feedback table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.message_feedback;

-- tonal_charter table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.tonal_charter;

-- apify_credit_usage table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.apify_credit_usage;

-- apify_plan_settings table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.apify_plan_settings;

-- manus_credit_usage table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.manus_credit_usage;

-- manus_plan_settings table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.manus_plan_settings;

-- newsapi_plan_settings table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.newsapi_plan_settings;

-- newsapi_usage table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.newsapi_usage;

-- pappers_queries table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.pappers_queries;

-- pappers_signals table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.pappers_signals;

-- pappers_scan_progress table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.pappers_scan_progress;

-- pappers_credit_usage table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.pappers_credit_usage;

-- pappers_plan_settings table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.pappers_plan_settings;

-- perplexity_usage table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.perplexity_usage;

-- salon_mariage_exposants table
DROP POLICY IF EXISTS "Allow all for anon users" ON public.salon_mariage_exposants;

-- 2. Enable RLS on any tables that might have it disabled
-- (The Supabase linter flagged this issue)

ALTER TABLE IF EXISTS public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.raw_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.company_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.linkedin_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.linkedin_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.linkedin_engagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.linkedin_scan_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.event_exhibitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.detected_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scrap_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.geo_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.partner_houses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.partner_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tonal_charter ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.apify_credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.apify_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manus_credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.manus_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.newsapi_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.newsapi_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pappers_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pappers_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pappers_scan_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pappers_credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pappers_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.perplexity_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.salon_mariage_exposants ENABLE ROW LEVEL SECURITY;
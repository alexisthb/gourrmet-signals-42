-- ============================================
-- Tables pour le module Scrap Exposants
-- ============================================

-- Table des sessions de scraping
CREATE TABLE IF NOT EXISTS scrap_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  apify_run_id TEXT,
  exhibitors_found INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des exposants scrapés
CREATE TABLE IF NOT EXISTS event_exhibitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  scrap_session_id UUID REFERENCES scrap_sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  website TEXT,
  source_url TEXT NOT NULL,
  images TEXT[] DEFAULT '{}',
  qualification_score INTEGER DEFAULT 1 CHECK (qualification_score BETWEEN 1 AND 5),
  target_category TEXT,
  stand_number TEXT,
  email TEXT,
  phone TEXT,
  siren TEXT,
  company_size TEXT,
  revenue TEXT,
  growth_rate TEXT,
  city TEXT,
  region TEXT,
  contact_name TEXT,
  contact_role TEXT,
  linkedin_url TEXT,
  enrichment_status TEXT DEFAULT 'none' CHECK (enrichment_status IN ('none', 'enriching', 'manus_processing', 'completed', 'failed', 'no_data', 'manus_error', 'no_api_key')),
  enriched_at TIMESTAMPTZ,
  is_contacted BOOLEAN DEFAULT FALSE,
  notes TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_event_exhibitors_session ON event_exhibitors(scrap_session_id);
CREATE INDEX IF NOT EXISTS idx_event_exhibitors_event ON event_exhibitors(event_id);
CREATE INDEX IF NOT EXISTS idx_event_exhibitors_score ON event_exhibitors(qualification_score DESC);
CREATE INDEX IF NOT EXISTS idx_scrap_sessions_status ON scrap_sessions(status);

-- RLS (Row Level Security)
ALTER TABLE scrap_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_exhibitors ENABLE ROW LEVEL SECURITY;

-- Policies pour accès public (à ajuster selon vos besoins de sécurité)
CREATE POLICY "Allow public read scrap_sessions" ON scrap_sessions FOR SELECT USING (true);
CREATE POLICY "Allow public insert scrap_sessions" ON scrap_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update scrap_sessions" ON scrap_sessions FOR UPDATE USING (true);

CREATE POLICY "Allow public read event_exhibitors" ON event_exhibitors FOR SELECT USING (true);
CREATE POLICY "Allow public insert event_exhibitors" ON event_exhibitors FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update event_exhibitors" ON event_exhibitors FOR UPDATE USING (true);
CREATE POLICY "Allow public delete event_exhibitors" ON event_exhibitors FOR DELETE USING (true);


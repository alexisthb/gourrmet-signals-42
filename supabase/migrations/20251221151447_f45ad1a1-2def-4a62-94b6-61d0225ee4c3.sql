-- =============================================
-- TABLES SCANNER PAPPERS
-- =============================================

-- Table des requêtes configurées pour Pappers
CREATE TABLE public.pappers_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('anniversary', 'nomination', 'capital_increase', 'transfer', 'creation')),
  is_active BOOLEAN DEFAULT true,
  parameters JSONB DEFAULT '{}',
  last_run_at TIMESTAMP WITH TIME ZONE,
  signals_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table des signaux détectés via Pappers
CREATE TABLE public.pappers_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_id UUID REFERENCES public.pappers_queries(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  siren TEXT,
  signal_type TEXT NOT NULL,
  signal_detail TEXT,
  relevance_score INTEGER DEFAULT 50,
  company_data JSONB DEFAULT '{}',
  processed BOOLEAN DEFAULT false,
  transferred_to_signals BOOLEAN DEFAULT false,
  signal_id UUID REFERENCES public.signals(id) ON DELETE SET NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABLES CRM ÉVÉNEMENTS
-- =============================================

-- Table des événements (salons, conférences, etc.)
CREATE TABLE public.events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'salon' CHECK (type IN ('salon', 'conference', 'networking', 'other')),
  date_start DATE NOT NULL,
  date_end DATE,
  location TEXT NOT NULL,
  address TEXT,
  description TEXT,
  website_url TEXT,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'attended', 'cancelled')),
  notes TEXT,
  contacts_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table des contacts rencontrés lors d'événements
CREATE TABLE public.event_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  job_title TEXT,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  notes TEXT,
  outreach_status TEXT DEFAULT 'new' CHECK (outreach_status IN ('new', 'contacted', 'responded', 'meeting', 'converted')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- TABLES SCANNER ÉVÉNEMENTS
-- =============================================

-- Table des événements détectés automatiquement
CREATE TABLE public.detected_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'salon',
  date_start DATE,
  date_end DATE,
  location TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  description TEXT,
  relevance_score INTEGER DEFAULT 50,
  is_added BOOLEAN DEFAULT false,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =============================================
-- RLS POLICIES
-- =============================================

ALTER TABLE public.pappers_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pappers_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_events ENABLE ROW LEVEL SECURITY;

-- Policies pour pappers_queries (accès public pour l'instant, pas d'auth)
CREATE POLICY "Allow all for anon users" ON public.pappers_queries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.pappers_queries FOR ALL USING (true) WITH CHECK (true);

-- Policies pour pappers_signals
CREATE POLICY "Allow all for anon users" ON public.pappers_signals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.pappers_signals FOR ALL USING (true) WITH CHECK (true);

-- Policies pour events
CREATE POLICY "Allow all for anon users" ON public.events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.events FOR ALL USING (true) WITH CHECK (true);

-- Policies pour event_contacts
CREATE POLICY "Allow all for anon users" ON public.event_contacts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.event_contacts FOR ALL USING (true) WITH CHECK (true);

-- Policies pour detected_events
CREATE POLICY "Allow all for anon users" ON public.detected_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.detected_events FOR ALL USING (true) WITH CHECK (true);

-- =============================================
-- TRIGGERS UPDATED_AT
-- =============================================

CREATE TRIGGER update_pappers_queries_updated_at
  BEFORE UPDATE ON public.pappers_queries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_event_contacts_updated_at
  BEFORE UPDATE ON public.event_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- INDEX POUR PERFORMANCES
-- =============================================

CREATE INDEX idx_pappers_signals_query_id ON public.pappers_signals(query_id);
CREATE INDEX idx_pappers_signals_signal_type ON public.pappers_signals(signal_type);
CREATE INDEX idx_pappers_signals_processed ON public.pappers_signals(processed);
CREATE INDEX idx_events_date_start ON public.events(date_start);
CREATE INDEX idx_events_status ON public.events(status);
CREATE INDEX idx_event_contacts_event_id ON public.event_contacts(event_id);
CREATE INDEX idx_detected_events_is_added ON public.detected_events(is_added);
CREATE INDEX idx_detected_events_relevance ON public.detected_events(relevance_score DESC);
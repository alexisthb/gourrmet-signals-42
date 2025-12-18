-- Create search_queries table
CREATE TABLE public.search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  query TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('anniversaire', 'levee', 'ma', 'distinction', 'expansion', 'nomination')),
  is_active BOOLEAN DEFAULT true,
  last_fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create raw_articles table
CREATE TABLE public.raw_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID REFERENCES public.search_queries(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  content TEXT,
  url TEXT UNIQUE NOT NULL,
  source_name TEXT,
  author TEXT,
  image_url TEXT,
  published_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  processed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_raw_articles_processed ON public.raw_articles(processed);
CREATE INDEX idx_raw_articles_fetched_at ON public.raw_articles(fetched_at DESC);
CREATE INDEX idx_raw_articles_published_at ON public.raw_articles(published_at DESC);

-- Create signals table
CREATE TABLE public.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id UUID REFERENCES public.raw_articles(id) ON DELETE SET NULL,
  company_name TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('anniversaire', 'levee', 'ma', 'distinction', 'expansion', 'nomination')),
  event_detail TEXT,
  sector TEXT,
  estimated_size TEXT CHECK (estimated_size IN ('PME', 'ETI', 'Grand Compte', 'Inconnu')),
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  hook_suggestion TEXT,
  source_url TEXT,
  source_name TEXT,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'meeting', 'proposal', 'won', 'lost', 'ignored')),
  notes TEXT,
  contacted_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_signals_status ON public.signals(status);
CREATE INDEX idx_signals_score ON public.signals(score DESC);
CREATE INDEX idx_signals_detected_at ON public.signals(detected_at DESC);
CREATE INDEX idx_signals_company ON public.signals(company_name);

-- Create settings table
CREATE TABLE public.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create scan_logs table
CREATE TABLE public.scan_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  articles_fetched INTEGER DEFAULT 0,
  articles_analyzed INTEGER DEFAULT 0,
  signals_created INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scan_logs_created ON public.scan_logs(created_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users (simple V1 policy)
CREATE POLICY "Allow all for authenticated users" ON public.search_queries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.raw_articles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.signals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.scan_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Also allow anon access for this demo app
CREATE POLICY "Allow all for anon users" ON public.search_queries FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon users" ON public.raw_articles FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon users" ON public.signals FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon users" ON public.settings FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon users" ON public.scan_logs FOR ALL TO anon USING (true) WITH CHECK (true);

-- Insert default settings
INSERT INTO public.settings (key, value) VALUES 
('newsapi_key', ''),
('claude_api_key', ''),
('min_score_display', '3'),
('days_to_fetch', '1');

-- Insert default search queries
INSERT INTO public.search_queries (name, query, category) VALUES
('Anniversaires - fête ses X ans', '("fête ses" OR "célèbre ses") AND "ans" AND (entreprise OR société OR cabinet OR groupe)', 'anniversaire'),
('Anniversaires - centenaire', '(centenaire OR "100 ans" OR "cinquantenaire" OR "50 ans") AND (entreprise OR cabinet)', 'anniversaire'),
('Levées de fonds - millions', '("lève" OR "levée de fonds") AND ("millions" OR "M€")', 'levee'),
('Levées - séries', '("série A" OR "série B" OR "série C" OR "tour de table")', 'levee'),
('M&A - acquisitions', '(acquisition OR rachat OR rachète) AND (entreprise OR groupe OR société)', 'ma'),
('M&A - fusions', '(fusion OR rapprochement OR "nouveau groupe") AND annonce', 'ma'),
('Distinctions - employeur', '("Great Place to Work" OR "meilleur employeur" OR "Top Employer")', 'distinction'),
('Distinctions - cabinets', '("Best Lawyers" OR "Legal 500" OR "Chambers" OR "Trophées du droit")', 'distinction'),
('Distinctions - palmarès', '(palmarès OR classement OR "élu meilleur") AND (entreprise OR cabinet)', 'distinction'),
('Expansion - inauguration', '(inaugure OR inauguration) AND (siège OR bureaux OR "nouveau site")', 'expansion'),
('Expansion - implantation', '("s''implante" OR "ouvre un bureau" OR "nouvelle implantation")', 'expansion'),
('Nominations - dirigeants', '(nommé OR nomination) AND (PDG OR "directeur général" OR CEO OR président)', 'nomination');
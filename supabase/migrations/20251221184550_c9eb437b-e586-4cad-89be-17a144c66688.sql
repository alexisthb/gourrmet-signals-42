-- Table pour stocker les sources LinkedIn à surveiller
CREATE TABLE public.linkedin_sources (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('profile', 'company')),
  linkedin_url text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  last_scraped_at timestamp with time zone,
  posts_count integer DEFAULT 0,
  engagers_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Ajouter une colonne source_id à linkedin_posts
ALTER TABLE public.linkedin_posts ADD COLUMN source_id uuid REFERENCES public.linkedin_sources(id);

-- Activer RLS
ALTER TABLE public.linkedin_sources ENABLE ROW LEVEL SECURITY;

-- Policies pour linkedin_sources
CREATE POLICY "Allow all for anon users" ON public.linkedin_sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.linkedin_sources FOR ALL USING (true) WITH CHECK (true);

-- Trigger pour updated_at
CREATE TRIGGER update_linkedin_sources_updated_at
BEFORE UPDATE ON public.linkedin_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insérer les sources initiales (Patrick Oualid et page Gourmet)
INSERT INTO public.linkedin_sources (name, source_type, linkedin_url) VALUES
  ('Patrick Oualid', 'profile', 'https://www.linkedin.com/in/patrickoualid/'),
  ('Gourmet', 'company', 'https://www.linkedin.com/company/gourmet-sarl/');
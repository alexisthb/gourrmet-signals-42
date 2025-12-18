-- Table pour stocker l'enrichissement des entreprises
CREATE TABLE public.company_enrichment (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  domain text,
  website text,
  linkedin_company_url text,
  description text,
  industry text,
  employee_count text,
  headquarters_location text,
  founded_year integer,
  enrichment_source text DEFAULT 'manus',
  raw_data jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(signal_id)
);

-- Table pour stocker les contacts trouvés
CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enrichment_id uuid NOT NULL REFERENCES public.company_enrichment(id) ON DELETE CASCADE,
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  first_name text,
  last_name text,
  job_title text,
  department text,
  location text,
  email_principal text,
  email_alternatif text,
  phone text,
  linkedin_url text,
  is_priority_target boolean DEFAULT false,
  priority_score integer DEFAULT 0 CHECK (priority_score >= 0 AND priority_score <= 5),
  outreach_status text DEFAULT 'new' CHECK (outreach_status IN ('new', 'linkedin_sent', 'email_sent', 'responded', 'meeting', 'converted', 'not_interested')),
  notes text,
  raw_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Ajouter colonne enrichment_status sur signals
ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS enrichment_status text DEFAULT 'none' CHECK (enrichment_status IN ('none', 'pending', 'processing', 'completed', 'failed'));

-- Index pour les requêtes fréquentes
CREATE INDEX idx_contacts_signal_id ON public.contacts(signal_id);
CREATE INDEX idx_contacts_enrichment_id ON public.contacts(enrichment_id);
CREATE INDEX idx_contacts_outreach_status ON public.contacts(outreach_status);
CREATE INDEX idx_company_enrichment_signal_id ON public.company_enrichment(signal_id);
CREATE INDEX idx_company_enrichment_status ON public.company_enrichment(status);
CREATE INDEX idx_signals_enrichment_status ON public.signals(enrichment_status);

-- Enable RLS
ALTER TABLE public.company_enrichment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies pour company_enrichment
CREATE POLICY "Allow all for anon users" ON public.company_enrichment FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.company_enrichment FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- RLS Policies pour contacts
CREATE POLICY "Allow all for anon users" ON public.contacts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger pour mettre à jour updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_company_enrichment_updated_at
  BEFORE UPDATE ON public.company_enrichment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
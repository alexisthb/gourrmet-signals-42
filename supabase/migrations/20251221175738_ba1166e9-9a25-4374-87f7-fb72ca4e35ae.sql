-- Table pour les paramètres du forfait Manus (enrichissement contacts presse)
CREATE TABLE public.manus_plan_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_name TEXT NOT NULL DEFAULT 'Standard',
  monthly_credits INTEGER NOT NULL DEFAULT 1000,
  current_period_start DATE NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE))::date,
  current_period_end DATE NOT NULL DEFAULT ((date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::date,
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  cost_per_enrichment NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour le suivi des crédits Manus
CREATE TABLE public.manus_credit_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  credits_used NUMERIC NOT NULL DEFAULT 0,
  enrichments_count INTEGER NOT NULL DEFAULT 0,
  signal_id UUID REFERENCES public.signals(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour les paramètres du forfait Apify (LinkedIn scraping)
CREATE TABLE public.apify_plan_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_name TEXT NOT NULL DEFAULT 'Starter',
  monthly_credits INTEGER NOT NULL DEFAULT 5000,
  current_period_start DATE NOT NULL DEFAULT (date_trunc('month', CURRENT_DATE))::date,
  current_period_end DATE NOT NULL DEFAULT ((date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day'))::date,
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  cost_per_scrape NUMERIC NOT NULL DEFAULT 0.5,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour le suivi des crédits Apify
CREATE TABLE public.apify_credit_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  credits_used NUMERIC NOT NULL DEFAULT 0,
  scrapes_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'linkedin', -- 'linkedin' ou 'presse'
  post_id UUID REFERENCES public.linkedin_posts(id),
  signal_id UUID REFERENCES public.signals(id),
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.manus_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manus_credit_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_plan_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apify_credit_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Allow all for anon users" ON public.manus_plan_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.manus_plan_settings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon users" ON public.manus_credit_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.manus_credit_usage FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon users" ON public.apify_plan_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.apify_plan_settings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for anon users" ON public.apify_credit_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.apify_credit_usage FOR ALL USING (true) WITH CHECK (true);

-- Insert default settings
INSERT INTO public.manus_plan_settings (plan_name, monthly_credits) VALUES ('Standard', 1000);
INSERT INTO public.apify_plan_settings (plan_name, monthly_credits) VALUES ('Starter', 5000);
-- Table pour les paramètres du forfait NewsAPI
CREATE TABLE public.newsapi_plan_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_name TEXT NOT NULL DEFAULT 'Developer',
  daily_requests INTEGER NOT NULL DEFAULT 100,
  current_period_start TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT date_trunc('day', now()),
  alert_threshold_percent INTEGER NOT NULL DEFAULT 80,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table pour l'utilisation des crédits NewsAPI
CREATE TABLE public.newsapi_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  requests_count INTEGER NOT NULL DEFAULT 0,
  articles_fetched INTEGER NOT NULL DEFAULT 0,
  query_id UUID REFERENCES public.search_queries(id),
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insérer les paramètres par défaut
INSERT INTO public.newsapi_plan_settings (plan_name, daily_requests, alert_threshold_percent)
VALUES ('Developer', 100, 80);

-- Index pour les requêtes par date
CREATE INDEX idx_newsapi_usage_date ON public.newsapi_usage(date);

-- Trigger pour mettre à jour updated_at
CREATE TRIGGER update_newsapi_plan_settings_updated_at
BEFORE UPDATE ON public.newsapi_plan_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
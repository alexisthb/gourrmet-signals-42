-- Add revenue columns to signals table
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS revenue BIGINT NULL,
ADD COLUMN IF NOT EXISTS revenue_source TEXT NULL;

-- Add revenue columns to linkedin_engagers table
ALTER TABLE public.linkedin_engagers 
ADD COLUMN IF NOT EXISTS company_revenue BIGINT NULL,
ADD COLUMN IF NOT EXISTS revenue_source TEXT NULL;

-- Add revenue column to contacts table
ALTER TABLE public.contacts 
ADD COLUMN IF NOT EXISTS company_revenue BIGINT NULL;

-- Add revenue column to pappers_signals (for consistency)
ALTER TABLE public.pappers_signals 
ADD COLUMN IF NOT EXISTS revenue BIGINT NULL,
ADD COLUMN IF NOT EXISTS revenue_source TEXT NULL;

-- Add index for revenue filtering
CREATE INDEX IF NOT EXISTS idx_signals_revenue ON public.signals(revenue);
CREATE INDEX IF NOT EXISTS idx_pappers_signals_revenue ON public.pappers_signals(revenue);
CREATE INDEX IF NOT EXISTS idx_contacts_company_revenue ON public.contacts(company_revenue);

-- Create perplexity_usage table for tracking API calls
CREATE TABLE IF NOT EXISTS public.perplexity_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_type TEXT NOT NULL,
  company_name TEXT,
  success BOOLEAN DEFAULT false,
  revenue_found BIGINT NULL,
  revenue_source TEXT NULL,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add comment for clarity
COMMENT ON COLUMN public.signals.revenue IS 'Company annual revenue in euros';
COMMENT ON COLUMN public.signals.revenue_source IS 'Source of revenue data: perplexity, pappers, or estimated';
COMMENT ON COLUMN public.perplexity_usage.revenue_source IS 'perplexity if found via API, estimated if calculated from employee count';
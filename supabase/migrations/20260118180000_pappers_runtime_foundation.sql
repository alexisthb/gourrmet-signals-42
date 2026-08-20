-- Ces trois tables existaient dans le live et dans types.ts, mais aucun CREATE TABLE
-- versionné ne permettait de reconstruire le projet avant les policies du 18 janvier.
CREATE TABLE IF NOT EXISTS public.pappers_plan_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name text NOT NULL DEFAULT 'Non configuré',
  monthly_credits integer NOT NULL DEFAULT 0 CHECK (monthly_credits >= 0),
  current_period_start date NOT NULL DEFAULT date_trunc('month', current_date)::date,
  current_period_end date NOT NULL DEFAULT (date_trunc('month', current_date) + interval '1 month - 1 day')::date,
  rate_limit_per_second numeric NOT NULL DEFAULT 2 CHECK (rate_limit_per_second > 0),
  results_per_page integer NOT NULL DEFAULT 100 CHECK (results_per_page BETWEEN 1 AND 100),
  alert_threshold_percent integer NOT NULL DEFAULT 80 CHECK (alert_threshold_percent BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pappers_scan_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid REFERENCES public.pappers_queries(id) ON DELETE SET NULL,
  scan_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'paused', 'completed', 'error', 'cancelled')),
  anniversary_years integer,
  current_page integer NOT NULL DEFAULT 0 CHECK (current_page >= 0),
  total_pages integer,
  total_results integer,
  processed_results integer NOT NULL DEFAULT 0 CHECK (processed_results >= 0),
  date_creation_min date,
  date_creation_max date,
  last_cursor text,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pappers_credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  credits_used numeric NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  search_credits numeric NOT NULL DEFAULT 0 CHECK (search_credits >= 0),
  company_credits numeric NOT NULL DEFAULT 0 CHECK (company_credits >= 0),
  api_calls integer NOT NULL DEFAULT 0 CHECK (api_calls >= 0),
  query_id uuid REFERENCES public.pappers_queries(id) ON DELETE SET NULL,
  scan_id uuid REFERENCES public.pappers_scan_progress(id) ON DELETE SET NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pappers_plan_settings (plan_name, monthly_credits)
SELECT 'Non configuré', 0
WHERE NOT EXISTS (SELECT 1 FROM public.pappers_plan_settings);

-- Le plan Pappers est une configuration singleton. Conserver la dernière ligne
-- évite que les clients `.single()` basculent silencieusement sur une limite par
-- défaut quand plusieurs plans historiques coexistent.
WITH ranked AS (
  SELECT id, row_number() OVER (
    ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
  ) AS position
  FROM public.pappers_plan_settings
)
DELETE FROM public.pappers_plan_settings AS settings
USING ranked
WHERE settings.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS pappers_plan_settings_singleton
  ON public.pappers_plan_settings ((true));

DO $$ BEGIN
  ALTER TABLE public.pappers_plan_settings
    ADD CONSTRAINT pappers_plan_settings_period_check
    CHECK (current_period_end >= current_period_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_pappers_credit_usage_date ON public.pappers_credit_usage(date);
CREATE INDEX IF NOT EXISTS idx_pappers_credit_usage_scan ON public.pappers_credit_usage(scan_id);
CREATE INDEX IF NOT EXISTS idx_pappers_scan_progress_created ON public.pappers_scan_progress(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pappers_scan_progress_status ON public.pappers_scan_progress(status);

DROP TRIGGER IF EXISTS update_pappers_plan_settings_updated_at ON public.pappers_plan_settings;
CREATE TRIGGER update_pappers_plan_settings_updated_at
  BEFORE UPDATE ON public.pappers_plan_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pappers_scan_progress_updated_at ON public.pappers_scan_progress;
CREATE TRIGGER update_pappers_scan_progress_updated_at
  BEFORE UPDATE ON public.pappers_scan_progress
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

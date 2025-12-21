-- Table pour suivre les scans LinkedIn orchestrés par Manus
CREATE TABLE IF NOT EXISTS public.linkedin_scan_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  manus_task_id TEXT,
  manus_task_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  sources_count INTEGER DEFAULT 0,
  max_posts INTEGER DEFAULT 4,
  posts_found INTEGER DEFAULT 0,
  engagers_found INTEGER DEFAULT 0,
  contacts_enriched INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  results JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.linkedin_scan_progress ENABLE ROW LEVEL SECURITY;

-- Policies for access
CREATE POLICY "Allow all for anon users" ON public.linkedin_scan_progress
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON public.linkedin_scan_progress
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_linkedin_scan_progress_updated_at
  BEFORE UPDATE ON public.linkedin_scan_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
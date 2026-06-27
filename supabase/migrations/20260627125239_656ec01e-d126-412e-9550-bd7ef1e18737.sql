-- 20260627002000_disable_linkedin_daily_scan.sql
DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-daily-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-daily-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 20260627003000_suspend_pappers_enrichment.sql
INSERT INTO public.settings (key, value)
VALUES ('pappers_enrichment_enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();

UPDATE public.company_enrichment ce
SET status = 'cancelled', updated_at = now()
FROM public.signals s
WHERE ce.signal_id = s.id
  AND s.source_name = 'Pappers'
  AND ce.status = 'manus_processing';

UPDATE public.enrichment_jobs ej
SET status = 'cancelled', finished_at = now()
FROM public.signals s
WHERE ej.signal_id = s.id
  AND s.source_name = 'Pappers'
  AND ej.job_type = 'contacts'
  AND ej.status IN ('pending', 'running');
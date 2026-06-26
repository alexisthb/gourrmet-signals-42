-- 20260626230000_auto_fetch_logos_cron.sql
DO $$
BEGIN
  PERFORM cron.unschedule('auto-fetch-logos-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-fetch-logos-tick');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-fetch-logos-tick',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/fetch-company-logo',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"batch": true, "minScore": 4, "skipManus": true, "limit": 10}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);

-- 20260627000000_linkedin_auto_scan_cron.sql
DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-daily-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-daily-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'linkedin-daily-scan',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/scan-linkedin-manus',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);

DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-scan-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-scan-poller');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'linkedin-scan-poller',
  '*/3 * * * *',
  $cron$
  UPDATE public.linkedin_scan_progress
    SET status = 'error',
        error_message = COALESCE(error_message, 'Timeout : tache Manus sans reponse > 6h (give-up auto)'),
        updated_at = now()
    WHERE status = 'manus_processing'
      AND created_at < now() - interval '6 hours';

  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/check-linkedin-scan-status',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('scan_id', id),
    timeout_milliseconds := 30000
  )
  FROM public.linkedin_scan_progress
  WHERE status = 'manus_processing';
  $cron$
);

-- 20260627001000_engager_enrichment_poller_cron.sql
DO $$
BEGIN
  PERFORM cron.unschedule('engager-enrichment-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engager-enrichment-poller');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'engager-enrichment-poller',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/check-engager-enrichment',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"batch": true}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
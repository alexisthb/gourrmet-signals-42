select cron.unschedule(jobid)
from cron.job
where jobname in (
  'enrichment-worker-tick', 'cron-check-linkedin-enrich-tick',
  'auto-fetch-logos-tick', 'scan-every-4-hours', 'process-email-queue',
  'daily-pappers-anniversary-scan', 'pappers-scan-every-12h',
  'pappers-recovery-every-minute'
);
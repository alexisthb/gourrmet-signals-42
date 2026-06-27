-- Désactive le scan LinkedIn QUOTIDIEN automatique (décision exploitation : éviter la
-- consommation de crédits Manus sans intervention manuelle).
--
-- IMPORTANT : on ne retire QUE le scan quotidien. Le poller (linkedin-scan-poller) et
-- son give-up restent actifs -> les scans LANCÉS MANUELLEMENT depuis l'app continuent
-- d'être importés et nettoyés automatiquement. Idem pour engager-enrichment-poller.
--
-- Pour réactiver le scan quotidien plus tard, rejouer la migration
-- 20260627000000_linkedin_auto_scan_cron.sql (ou re-cron.schedule('linkedin-daily-scan', ...)).

DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-daily-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-daily-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule cron-check-manus toutes les minutes.
--
-- CAUSE RACINE des "Manus en continu" / enrichissements contacts bloqués :
-- la fonction cron-check-manus (qui poll les company_enrichment en
-- 'manus_processing' et persiste les contacts quand la tâche Manus se termine)
-- n'était schedulée NULLE PART. Les seuls crons réellement actifs étaient
-- fetch-pappers, run-full-scan, enrichment-worker (et cron-check-logos ajouté
-- dans la migration précédente). Résultat : côté serveur, un enrichissement
-- contacts ne se finalisait JAMAIS — seul le polling frontend (fiche ouverte)
-- le faisait. Dès que Clotilde fermait la fiche, le signal restait
-- "Manus en cours" indéfiniment.
--
-- Ce cron ferme la boucle : enrichment-worker LANCE la tâche Manus,
-- cron-check-manus la RÉCUPÈRE et persiste les contacts.
--
-- Même convention que enrichment-worker-tick (cf. 20260517141000).

DO $$
BEGIN
  PERFORM cron.unschedule('cron-check-manus-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-check-manus-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'cron-check-manus-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/cron-check-manus',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

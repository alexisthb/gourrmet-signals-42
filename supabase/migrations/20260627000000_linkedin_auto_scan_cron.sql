-- Scan LinkedIn AUTOMATIQUE (arbitrage utilisateur : "je veux un scan quotidien auto").
--
-- CAUSE RACINE (audit métier) : scan-linkedin-manus et check-linkedin-scan-status
-- n'etaient invoques QUE depuis le front sur action manuelle. Aucun cron ne les ciblait
-- (les seuls crons actifs : fetch-pappers, run-full-scan, enrichment-worker,
-- cron-check-manus, cron-check-logos, process-email-queue, auto-fetch-logos). Resultat :
-- sans clic manuel, zero signal LinkedIn ; et un scan lance restait 'manus_processing'
-- indefiniment si personne ne gardait la page ouverte (engagers jamais importes,
-- credit Manus consomme pour rien).
--
-- Cette migration ferme la boucle, 100% en SQL (aucune modif des fonctions) :
--   1. linkedin-daily-scan  : 1 scan/jour de TOUTES les sources actives. scan-linkedin-manus
--      a deja son garde-fou credits Manus (402 si epuises) -> cout borne.
--   2. linkedin-scan-poller : toutes les 3 min, (a) give-up des scans bloques > 6h
--      (marques 'error'), puis (b) un check-linkedin-scan-status par scan encore en cours
--      -> rapatrie les engagers automatiquement, comme cron-check-manus pour les contacts.
--
-- scan-linkedin-manus et check-linkedin-scan-status sont en verify_jwt=false -> pas de
-- header Authorization necessaire (idem cron-check-manus).

-- 1) Scan quotidien (06:00 UTC) de toutes les sources actives
DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-daily-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-daily-scan');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'linkedin-daily-scan',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/scan-linkedin-manus',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- 2) Poller : give-up des scans zombies + rapatriement des scans en cours
DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-scan-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'linkedin-scan-poller');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'linkedin-scan-poller',
  '*/3 * * * *',
  $$
  -- (a) give-up : un scan bloque en 'manus_processing' > 6h = tache Manus morte -> 'error'
  UPDATE public.linkedin_scan_progress
    SET status = 'error',
        error_message = COALESCE(error_message, 'Timeout : tache Manus sans reponse > 6h (give-up auto)'),
        updated_at = now()
    WHERE status = 'manus_processing'
      AND created_at < now() - interval '6 hours';

  -- (b) poll : un appel check-linkedin-scan-status par scan encore en cours
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/check-linkedin-scan-status',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('scan_id', id),
    timeout_milliseconds := 30000
  )
  FROM public.linkedin_scan_progress
  WHERE status = 'manus_processing';
  $$
);

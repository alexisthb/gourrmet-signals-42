-- Poller des enrichissements de contacts LinkedIn (engagers).
--
-- CAUSE RACINE (audit) : enrich-linkedin-engager crée un contact en
-- outreach_status='manus_processing', mais sa finalisation dépendait UNIQUEMENT
-- de check-engager-enrichment appelé depuis le front (aucun cron). Sans page
-- ouverte, le contact restait 'manus_processing' à vie -> exactement le bug
-- "Manus en continu" corrigé pour la Presse mais jamais porté ici.
--
-- check-engager-enrichment a déjà un mode batch (vérifie tous les contacts
-- source='linkedin' AND outreach_status='manus_processing'). Avec le give-up
-- anti-zombie ajouté dans cette PR (statut terminal Manus ou tâche > 6h ->
-- 'failed'), ce cron ferme la boucle automatiquement.
--
-- check-engager-enrichment est en verify_jwt=false -> pas de header Authorization.

DO $$
BEGIN
  PERFORM cron.unschedule('engager-enrichment-poller')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engager-enrichment-poller');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'engager-enrichment-poller',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/check-engager-enrichment',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"batch": true}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

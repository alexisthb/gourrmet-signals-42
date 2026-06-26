-- Cron auto-logos : récupère automatiquement le logo des signaux FORTS (>=4*) qui n'en ont pas.
--
-- CAUSE RACINE (audit métier) : aucun chemin n'initiait jamais fetch-company-logo
-- automatiquement. analyze-articles n'auto-déclenchait que l'enrichissement CONTACTS
-- (trigger-manus-enrichment), jamais le logo. Resultat : les logos ne se telechargeaient
-- que sur clic manuel ou backfill admin -> "les logos ne se telechargent pas tout seuls
-- sur les 4 etoiles et plus". Et generate-gift-image EXIGE company_logo_url, donc le
-- visuel cadeau restait bloque.
--
-- Ce cron ferme la boucle, toutes sources confondues (Presse/Pappers/LinkedIn), via le
-- mode batch de fetch-company-logo :
--   - minScore=4   : ne logote que les signaux vendables (respecte la regle 4*)
--   - skipManus    : sources GRATUITES uniquement (Clearbit + Google favicon) -> 0 credit
--                    Manus brule en automatique ; Manus reste reserve au bouton manuel.
--   - le batch filtre deja company_logo_url IS NULL ET logo_manus_task_id IS NULL
--     (anti-doublon : ne retouche pas une tache logo deja en vol).
-- Auto-reparateur : retente a chaque cycle les signaux gratuitement (aucun cout).
--
-- fetch-company-logo est en verify_jwt=false (comme cron-check-manus/logos), donc pas
-- de header Authorization necessaire.

DO $$
BEGIN
  PERFORM cron.unschedule('auto-fetch-logos-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-fetch-logos-tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'auto-fetch-logos-tick',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/fetch-company-logo',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"batch": true, "minScore": 4, "skipManus": true, "limit": 10}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

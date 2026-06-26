-- Schedule du dispatcher d'emails (process-email-queue).
--
-- CAUSE RACINE des emails non envoyés : la fonction process-email-queue (qui
-- dépile les queues pgmq auth_emails / transactional_emails et appelle l'API
-- Lovable Email) n'était schedulée NULLE PART. Les seuls crons réellement
-- actifs : fetch-pappers, run-full-scan, enrichment-worker, cron-check-manus,
-- cron-check-logos. Résultat : un email part bien en queue (toast "envoyé"),
-- mais rien ne le dispatche → il reste en queue indéfiniment.
--
-- Particularité : process-email-queue exige verify_jwt=true ET un claim
-- role='service_role' (cf. supabase/functions/process-email-queue/index.ts:104).
-- Le cron doit donc passer le JWT service_role en Authorization. On le lit
-- depuis le vault (secret 'email_queue_service_role_key'), conformément au
-- design de la migration email_infra (post-step Management API).
--
-- ⚠️ PRÉREQUIS : le secret vault 'email_queue_service_role_key' doit exister
-- et contenir la clé service_role (JWT). Sinon le cron appellera avec un Bearer
-- vide → 401 (sans danger, mais aucun email ne partira). Pour le créer :
--   SELECT vault.create_secret('<SERVICE_ROLE_KEY>', 'email_queue_service_role_key');
-- (ou laisser l'outil de setup email natif de Lovable le créer.)

DO $$
BEGIN
  PERFORM cron.unschedule('process-email-queue')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Toutes les 10 secondes (pg_cron >= 1.5 supporte la granularité seconde).
SELECT cron.schedule(
  'process-email-queue',
  '10 seconds',
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);

-- ============================================
-- CRON JOB : Scan quotidien des anniversaires Pappers
-- ============================================
-- Ce job s'exécute tous les jours à 6h00 (Paris)
-- Il détecte les entreprises qui fêteront un anniversaire dans 9 mois
-- 
-- Exemple : Le 7 janvier 2026, il cherche les anniversaires du 7 octobre 2026

-- 1. S'assurer que les extensions sont actives
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Créer le cron job quotidien pour Pappers (anniversaires)
-- NOTE: Remplacer l'URL et la clé service par vos valeurs réelles
-- URL format: https://[PROJECT_ID].supabase.co/functions/v1/fetch-pappers
SELECT cron.schedule(
  'daily-pappers-anniversary-scan',  -- Nom unique du job
  '0 5 * * *',                        -- Cron: 5h UTC = 6h Paris (heure d'hiver)
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/fetch-pappers',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 3. Créer aussi un cron pour le scan presse (articles NewsAPI + analyse Claude)
SELECT cron.schedule(
  'daily-press-scan',                 -- Nom unique du job
  '0 6 * * *',                        -- Cron: 6h UTC = 7h Paris
  $$
  SELECT net.http_post(
    url := 'https://tzghzftxhxlvliekqiav.supabase.co/functions/v1/run-full-scan',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- 4. Pour vérifier les jobs après migration :
-- SELECT jobid, jobname, schedule, active FROM cron.job;

-- 5. Pour supprimer un job si besoin :
-- SELECT cron.unschedule('daily-pappers-anniversary-scan');

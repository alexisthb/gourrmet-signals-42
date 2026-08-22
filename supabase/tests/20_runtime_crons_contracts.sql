\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';
DO $$
DECLARE r jsonb; n integer;
BEGIN
  DELETE FROM cron.job;
  INSERT INTO cron.job (schedule, command, jobname) VALUES
    ('* * * * *','x','enrichment-worker-tick'),
    ('* * * * *','x','cron-check-linkedin-enrich-tick'),
    ('* * * * *','x','auto-fetch-logos-tick'),
    ('* * * * *','x','scan-every-4-hours'),
    ('* * * * *','x','process-email-queue'),
    ('* * * * *','x','daily-pappers-anniversary-scan'),
    -- L'ANCIEN nom, à dessein : le contrat vérifie que configure() sait
    -- retirer un job hérité de la génération « every-12h » (renommée en
    -- pappers-scan-daily le 2026-08-22, cadence quotidienne encodée).
    ('* * * * *','x','pappers-scan-every-12h'),
    ('* * * * *','x','un-job-etranger-a-ne-pas-toucher');

  -- domaine inconnu -> refus
  BEGIN
    r := public.configure_gourrmet_runtime_crons(false, ARRAY['inexistant']);
    RAISE EXCEPTION 'un domaine inconnu aurait du etre refuse';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- couper UNIQUEMENT le domaine email
  r := public.configure_gourrmet_runtime_crons(false, ARRAY['email']);
  ASSERT (r->>'removed_jobs')::int = 1, 'email doit retirer exactement 1 job, obtenu ' || (r->>'removed_jobs');
  ASSERT NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='process-email-queue'), 'job email non retire';
  SELECT count(*) INTO n FROM cron.job;
  ASSERT n = 7, 'les autres domaines ne doivent pas etre touches, restants: ' || n;

  -- couper pappers (2 jobs) sans toucher au reste
  r := public.configure_gourrmet_runtime_crons(false, ARRAY['pappers']);
  ASSERT (r->>'removed_jobs')::int = 2, 'pappers doit retirer 2 jobs, obtenu ' || (r->>'removed_jobs');
  SELECT count(*) INTO n FROM cron.job;
  ASSERT n = 5, 'restants apres pappers: ' || n;

  -- le job etranger survit a tout
  r := public.configure_gourrmet_runtime_crons(false, ARRAY['email','enrichment','logos','press','pappers']);
  ASSERT EXISTS (SELECT 1 FROM cron.job WHERE jobname='un-job-etranger-a-ne-pas-toucher'),
    'un job hors perimetre ne doit JAMAIS etre supprime';
  SELECT count(*) INTO n FROM cron.job;
  ASSERT n = 1, 'seul le job etranger doit rester, restants: ' || n;

  ASSERT r->>'status' = 'disabled', 'statut attendu disabled, obtenu ' || (r->>'status');
  RAISE NOTICE 'CONTRATS CRON PAR DOMAINES VERIFIES';
END $$;

-- ═══ La cadence Pappers encodée est QUOTIDIENNE ═══
-- Le banc ne peut pas exécuter les cron.schedule (vault absent), alors on
-- verrouille la DÉFINITION : 500 crédits/période à ~9 par scan quotidien ne
-- financent pas une cadence 12 h — elle épuiserait le quota en quatre jours
-- et éteindrait la détection avant la fin de période, en silence (2026-08-22).
DO $$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.configure_gourrmet_runtime_crons(boolean, text[])'::regprocedure);
  ASSERT def LIKE '%''pappers-scan-daily'', ''0 2 * * *''%',
    'la cadence Pappers encodee doit etre pappers-scan-daily @ 0 2 * * *';
  ASSERT def NOT LIKE '%''pappers-scan-every-12h'', ''0 */12 * * *''%',
    'la cadence 12h ne doit plus etre programmable : le quota ne la finance pas';
  RAISE NOTICE 'OK — cadence Pappers quotidienne verrouillee';
END $$;

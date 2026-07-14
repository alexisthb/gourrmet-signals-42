-- Tout l'enrichissement contacts passe par LinkedIn+Dropcontact (Presse incluse) + retrait de Manus
-- + plafond de scoring taille (une petite entreprise ne doit jamais être 4/5).
--
-- Volet CODE (déployé à part) : enrichment-worker route TOUTES les sources vers
-- enrich-contacts-linkedin (gate source_name=Pappers retiré, défaut provider='linkedin') ;
-- analyze-articles enqueue au lieu d'appeler Manus ; run-pappers-scan & fetch-pappers plafonnent
-- le relevance_score des petites entreprises. Ce fichier porte les changements DONNÉES/CONFIG.

-- 1) Provider d'enrichissement = linkedin (défaut désormais, pour toutes les sources).
INSERT INTO settings (key, value) VALUES ('enrichment_provider', 'linkedin')
ON CONFLICT (key) DO UPDATE SET value = 'linkedin';

-- 2) Backfill scoring : plafonner à 3 les signaux 4/5 de petites entreprises
--    (PME/Inconnu sans CA costaud >= 5 M€). ETI, Grand Compte, ou CA >= 5 M€ conservés.
--    Effet : ils sortent du périmètre d'enrichissement (>= 4) sans disparaître (visibles >= 3).
UPDATE signals
SET score = LEAST(score, 3)
WHERE score >= 4
  AND (status IS NULL OR status <> 'archived')
  AND estimated_size IN ('PME', 'Inconnu')
  AND (revenue IS NULL OR revenue < 5000000);

-- 3) Retrait de Manus — clé API supprimée des settings.
DELETE FROM settings WHERE key = 'manus_api_key';

-- 4) Retrait de Manus — les tâches contact Manus en vol (compte Manus mort) ne se termineront
--    jamais : on les marque 'failed' pour qu'elles soient ré-enrichies via LinkedIn.
UPDATE company_enrichment SET status = 'failed', error_message = 'Manus retiré — à ré-enrichir via LinkedIn'
WHERE status = 'manus_processing';

-- 5) Retrait de Manus — désactivation du cron de poll des contacts Manus (plus rien à poller).
DO $$ BEGIN
  PERFORM cron.unschedule('cron-check-manus-tick')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cron-check-manus-tick');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- 6) Hygiène repro : neutraliser d'anciens crons SANS Authorization qui, sur un rebuild à zéro,
--    frapperaient des fonctions désormais verify_jwt=true (401). Ils ne sont plus dans le cron
--    live (remplacés par scan-every-4-hours / pappers-scan-every-12h authentifiés).
DO $$ BEGIN
  PERFORM cron.unschedule('daily-press-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-press-scan');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
  PERFORM cron.unschedule('daily-pappers-anniversary-scan')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-pappers-anniversary-scan');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

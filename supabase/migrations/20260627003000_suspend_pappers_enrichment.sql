-- Suspend l'enrichissement Manus CONTACTS des signaux Pappers (decision exploitation).
--
-- Mecanisme (cf. gates code dans trigger-manus-enrichment + enqueue-enrichment) :
-- un flag DB pilote la coupure, reversible SANS redeploiement.
--   - flag absent OU 'true'  -> enrichissement Pappers ACTIF (comportement par defaut)
--   - flag = 'false'         -> enrichissement Pappers SUSPENDU
-- Convention identique a auto_enrich_enabled (seul 'false' bloque).
--
-- Cette migration ACTIVE la suspension (flag a 'false') + ferme le trou des taches
-- DEJA EN VOL : sans ca, un signal Pappers dont la tache Manus a demarre avant la
-- coupure continuerait de produire ses contacts via cron-check-manus / le bouton
-- "Verifier le statut" (qui ne passent pas par le gate de lancement). On annule donc
-- les enrichissements Pappers en cours + leurs jobs en file.
--
-- POUR REACTIVER plus tard (sans redeploy) :
--   UPDATE public.settings SET value='true', updated_at=now()
--   WHERE key='pappers_enrichment_enabled';
-- Les NOUVEAUX signaux Pappers seront alors de nouveau enrichis (les enrichissements
-- annules ci-dessous ne repartent pas tout seuls : relancer manuellement si besoin).

-- 1) Active la suspension
INSERT INTO public.settings (key, value)
VALUES ('pappers_enrichment_enabled', 'false')
ON CONFLICT (key) DO UPDATE SET value = 'false', updated_at = now();

-- 2) Annule les enrichissements Pappers DEJA EN VOL (sinon recoltes par cron-check-manus)
UPDATE public.company_enrichment ce
SET status = 'cancelled', updated_at = now()
FROM public.signals s
WHERE ce.signal_id = s.id
  AND s.source_name = 'Pappers'
  AND ce.status = 'manus_processing';

-- 3) Annule les jobs d'enrichissement Pappers encore en file (pending/running)
UPDATE public.enrichment_jobs ej
SET status = 'cancelled', finished_at = now()
FROM public.signals s
WHERE ej.signal_id = s.id
  AND s.source_name = 'Pappers'
  AND ej.job_type = 'contacts'
  AND ej.status IN ('pending', 'running');

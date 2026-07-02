-- RATTRAPAGE après le fix du format de date Pappers.
--
-- fetch-pappers (le scanner schedulé par le cron quotidien) envoyait date_creation_min/max
-- en AAAA-MM-JJ alors que l'API Pappers attend JJ-MM-AAAA -> l'API ne renvoyait rien ->
-- 0 signal Pappers créé pendant des mois. Le code est corrigé (formatDateForPappers).
--
-- Pendant la panne, last_run_at continuait d'être avancé, donc le scanner tourne en mode
-- "incrémental" (une seule date exacte par jour). En remettant last_run_at à NULL sur les
-- requêtes actives, le prochain passage repart en "premier scan" (mois entier autour de la
-- date d'anniversaire cible) -> rattrapage des anniversaires manqués, au lieu de repartir
-- d'un seul jour.
UPDATE public.pappers_queries
SET last_run_at = NULL
WHERE is_active = true;

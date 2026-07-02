-- RATTRAPAGE après le fix du filtre effectif Pappers.
--
-- 2e cause de la panne « 0 signal » (indépendante du format de date corrigé en #53) :
-- fetch-pappers envoyait tranche_effectif_min = effectif BRUT ("20", "50"...) alors que
-- l'API Pappers attend un CODE de tranche INSEE ("12" = 20-49, "21" = 50-99...). Le filtre
-- ne matchait donc AUCUNE entreprise dès qu'un effectif minimum était réglé sur la requête.
-- Le code convertit désormais l'effectif brut vers le bon code de tranche.
--
-- On remet last_run_at à NULL sur les requêtes actives pour que le prochain passage reparte
-- en « premier scan » (mois entier autour de la date d'anniversaire cible) avec les bons
-- paramètres, et rattrape les anniversaires manqués — au lieu de repartir d'une fenêtre
-- incrémentale.
UPDATE public.pappers_queries
SET last_run_at = NULL
WHERE is_active = true;

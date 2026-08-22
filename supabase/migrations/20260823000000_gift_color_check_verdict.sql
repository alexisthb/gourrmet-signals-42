-- LE VERDICT DE LA RÈGLE D'OR, PERSISTÉ SUR CHAQUE VISUEL.
--
-- La règle métier est physique : sur du chocolat, le seul colorant
-- alimentaire praticable est le blanc. Trois générations de consignes au
-- modèle d'image n'ont pas suffi — la dernière (2026-08-22, sous-éléments
-- nommés) a encore laissé passer de la couleur. Une consigne réduit la
-- probabilité ; seul un VÉRIFICATEUR la mesure.
--
-- `generate-gift-image` vérifie désormais chaque image chocolat par un
-- modèle de vision, régénère une fois si besoin, et écrit ici le verdict
-- final :
--   { "verdict": "passed" | "failed" | "unverified" | "not_applicable",
--     "elements_colores": [...], "verified_at": "..." }
--
-- Un « failed » n'est PAS livré : le visuel passe en statut d'échec avec la
-- liste des éléments colorés — infabricable en alimentaire, une image
-- fautive est commercialement inutilisable, et la livrer « avec
-- avertissement » revenait à la laisser partir chez un prospect (l'opérateur
-- voit l'image, pas le verdict — constaté le 2026-08-22 au soir). L'image
-- reste archivée pour l'inspection. « unverified » (vérificateur en panne)
-- ne bloque pas : sans preuve de faute, on livre et on le dit.
-- La requête ci-dessous mesure le taux de conformité réel du générateur, ce
-- qu'aucune consigne ne dira jamais :
--
--   SELECT color_check->>'verdict', count(*)
--   FROM generated_gifts WHERE color_check IS NOT NULL GROUP BY 1;

ALTER TABLE public.generated_gifts
  ADD COLUMN IF NOT EXISTS color_check jsonb;

COMMENT ON COLUMN public.generated_gifts.color_check IS
  'Verdict du verificateur de couleurs (regle d or chocolat : blanc '
  'uniquement). passed / failed (+ elements_colores) / unverified (verificateur '
  'en panne) / not_applicable (gabarit non-chocolat). Un failed N EST PAS '
  'livre : statut d echec franc, image archivee pour inspection.';

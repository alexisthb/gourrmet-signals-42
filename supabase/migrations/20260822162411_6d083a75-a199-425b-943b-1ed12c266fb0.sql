ALTER TABLE public.generated_gifts
  ADD COLUMN IF NOT EXISTS color_check jsonb;

COMMENT ON COLUMN public.generated_gifts.color_check IS
  'Verdict du verificateur de couleurs (regle d or chocolat : blanc '
  'uniquement). passed / failed (+ elements_colores) / unverified (verificateur '
  'en panne) / not_applicable (gabarit non-chocolat). Un failed N EST PAS '
  'livre : statut d echec franc, image archivee pour inspection.';
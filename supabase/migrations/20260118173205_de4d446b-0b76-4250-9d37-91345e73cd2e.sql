-- Ajouter les colonnes manquantes à la table salon_mariage_exposants
ALTER TABLE public.salon_mariage_exposants 
ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 3 CHECK (tier >= 1 AND tier <= 4),
ADD COLUMN IF NOT EXISTS siret TEXT,
ADD COLUMN IF NOT EXISTS source_notes TEXT;

-- Mettre à jour les options de outreach_status pour le workflow complet
COMMENT ON COLUMN public.salon_mariage_exposants.outreach_status IS 'Workflow: not_contacted -> researched -> met_at_event -> demo_scheduled -> follow_up_sent -> proposal_sent -> converted -> not_interested';
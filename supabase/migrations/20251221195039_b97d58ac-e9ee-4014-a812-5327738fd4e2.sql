-- Rendre enrichment_id nullable pour permettre les contacts issus de LinkedIn
ALTER TABLE public.contacts ALTER COLUMN enrichment_id DROP NOT NULL;

-- Ajouter une colonne source pour différencier l'origine des contacts
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'signal';

-- Ajouter un index sur source
CREATE INDEX IF NOT EXISTS idx_contacts_source ON public.contacts(source);

-- Mettre à jour les contacts existants
UPDATE public.contacts SET source = 'signal' WHERE source IS NULL;
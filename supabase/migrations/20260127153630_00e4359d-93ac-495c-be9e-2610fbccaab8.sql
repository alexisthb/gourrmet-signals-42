-- Table pour logger toutes les interactions sur les contacts
CREATE TABLE public.contact_interactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL, -- 'status_change', 'linkedin_message_generated', 'email_generated', 'linkedin_message_copied', 'email_copied', 'note_added'
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index pour requêtes fréquentes par contact
CREATE INDEX idx_contact_interactions_contact_id ON public.contact_interactions(contact_id);
CREATE INDEX idx_contact_interactions_created_at ON public.contact_interactions(created_at DESC);

-- Enable RLS
ALTER TABLE public.contact_interactions ENABLE ROW LEVEL SECURITY;

-- Policies pour utilisateurs authentifiés
CREATE POLICY "Authenticated users can read contact_interactions"
  ON public.contact_interactions FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can insert contact_interactions"
  ON public.contact_interactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete contact_interactions"
  ON public.contact_interactions FOR DELETE
  USING (true);

-- Ajouter colonnes pour la prochaine action sur contacts
ALTER TABLE public.contacts
  ADD COLUMN next_action_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN next_action_note TEXT;

-- Index pour filtrer les contacts avec prochaine action
CREATE INDEX idx_contacts_next_action_at ON public.contacts(next_action_at) WHERE next_action_at IS NOT NULL;
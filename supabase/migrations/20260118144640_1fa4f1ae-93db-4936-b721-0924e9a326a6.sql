-- Table pour stocker TOUTES les corrections de messages
CREATE TABLE public.message_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_type TEXT NOT NULL CHECK (message_type IN ('inmail', 'email')),
  original_message TEXT NOT NULL,
  edited_message TEXT NOT NULL,
  original_subject TEXT,
  edited_subject TEXT,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table unique pour la charte tonale évolutive
CREATE TABLE public.tonal_charter (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  charter_data JSONB NOT NULL DEFAULT '{
    "formality": {
      "level": "neutre",
      "tutoyment": false,
      "observations": []
    },
    "structure": {
      "max_paragraphs": 3,
      "sentence_length": "moyenne",
      "observations": []
    },
    "vocabulary": {
      "forbidden_words": [],
      "preferred_words": [],
      "observations": []
    },
    "tone": {
      "style": "professionnel",
      "humor_allowed": false,
      "observations": []
    },
    "signatures": {
      "preferred": [],
      "avoided": [],
      "observations": []
    },
    "openings": {
      "preferred": [],
      "avoided": [],
      "observations": []
    }
  }',
  corrections_count INTEGER NOT NULL DEFAULT 0,
  last_analysis_at TIMESTAMP WITH TIME ZONE,
  confidence_score DECIMAL(3,2) NOT NULL DEFAULT 0.00 CHECK (confidence_score >= 0 AND confidence_score <= 1),
  is_learning_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Créer le trigger pour updated_at
CREATE TRIGGER update_tonal_charter_updated_at
  BEFORE UPDATE ON public.tonal_charter
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insérer la ligne unique pour la charte
INSERT INTO public.tonal_charter (id) VALUES (gen_random_uuid());

-- Index pour les requêtes sur message_feedback
CREATE INDEX idx_message_feedback_created_at ON public.message_feedback(created_at DESC);
CREATE INDEX idx_message_feedback_type ON public.message_feedback(message_type);
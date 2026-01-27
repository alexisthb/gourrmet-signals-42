-- Create signal_interactions table to track user actions on signals
CREATE TABLE public.signal_interactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_id UUID NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.signal_interactions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can read signal_interactions"
ON public.signal_interactions
FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can insert signal_interactions"
ON public.signal_interactions
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete signal_interactions"
ON public.signal_interactions
FOR DELETE
USING (true);

-- Add next_action fields to signals table
ALTER TABLE public.signals 
ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS next_action_note TEXT;

-- Create index for faster queries
CREATE INDEX idx_signal_interactions_signal_id ON public.signal_interactions(signal_id);
CREATE INDEX idx_signal_interactions_created_at ON public.signal_interactions(created_at DESC);
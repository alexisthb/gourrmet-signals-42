-- Autoriser le type de signal LinkedIn (utilisé pour créer des contacts LinkedIn)
-- Le système actuel impose une liste blanche via une contrainte CHECK.
ALTER TABLE public.signals
  DROP CONSTRAINT IF EXISTS signals_signal_type_check;

ALTER TABLE public.signals
  ADD CONSTRAINT signals_signal_type_check
  CHECK (
    signal_type = ANY (
      ARRAY[
        'anniversaire'::text,
        'levee'::text,
        'ma'::text,
        'distinction'::text,
        'expansion'::text,
        'nomination'::text,
        'linkedin_engagement'::text
      ]
    )
  );

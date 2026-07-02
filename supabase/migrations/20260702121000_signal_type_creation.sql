-- Transfert des signaux Pappers 'creation' impossible (audit Fable, confirme).
--
-- useTransferToSignals mappe le type Pappers 'creation' -> 'creation' (1:1), mais la
-- contrainte signals_signal_type_check (20251221205032) ne l'autorise pas : l'INSERT
-- viole le CHECK -> toast « Erreur » et signal intransferable. C'est le SEUL type dans
-- ce cas (les autres types Pappers sont mappes vers des valeurs autorisees).
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
        'linkedin_engagement'::text,
        'creation'::text
      ]
    )
  );

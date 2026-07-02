-- 20260702120000_logo_fetch_tracking
ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS logo_fetch_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS logo_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS logo_fetch_status text,
  ADD COLUMN IF NOT EXISTS logo_manus_started_at timestamptz;

UPDATE public.signals
SET logo_manus_started_at = now()
WHERE logo_manus_task_id IS NOT NULL AND logo_manus_started_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_signals_logo_batch
  ON public.signals (logo_last_attempt_at ASC NULLS FIRST, detected_at DESC)
  WHERE company_logo_url IS NULL AND logo_manus_task_id IS NULL;

-- 20260702121000_signal_type_creation
ALTER TABLE public.signals DROP CONSTRAINT IF EXISTS signals_signal_type_check;
ALTER TABLE public.signals
  ADD CONSTRAINT signals_signal_type_check
  CHECK (signal_type = ANY (ARRAY['anniversaire'::text,'levee'::text,'ma'::text,'distinction'::text,'expansion'::text,'nomination'::text,'linkedin_engagement'::text,'creation'::text]));

-- 20260702130000_pappers_date_format_recovery
UPDATE public.pappers_queries SET last_run_at = NULL WHERE is_active = true;

-- 20260702140000_pappers_dedup_unique_index
DELETE FROM public.pappers_signals p
USING (
  SELECT id, row_number() OVER (
    PARTITION BY siren, signal_type
    ORDER BY transferred_to_signals DESC, detected_at ASC, id ASC
  ) AS rn
  FROM public.pappers_signals
  WHERE siren IS NOT NULL AND signal_type IN ('anniversary','creation')
) d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pappers_signals_siren_type_stable
  ON public.pappers_signals (siren, signal_type)
  WHERE siren IS NOT NULL AND signal_type IN ('anniversary','creation');

CREATE INDEX IF NOT EXISTS idx_pappers_signals_siren_type_detected
  ON public.pappers_signals (siren, signal_type, detected_at DESC);
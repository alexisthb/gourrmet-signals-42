CREATE INDEX IF NOT EXISTS generated_gifts_signal_created_idx
  ON public.generated_gifts (signal_id, created_at DESC);
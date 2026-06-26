UPDATE public.signals
SET status = 'new'
WHERE status = 'ignored'
  AND source_name IS DISTINCT FROM 'Pappers'
  AND source_name IS DISTINCT FROM 'LinkedIn';
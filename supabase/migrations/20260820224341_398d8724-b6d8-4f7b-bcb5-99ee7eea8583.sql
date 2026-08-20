DO $$
DECLARE s jsonb; e jsonb;
BEGIN
  SELECT public.apify_actor_run_quota_status(now()) INTO s;
  RAISE NOTICE 'apify_status=%', s;
  IF (s->>'configured')::boolean IS TRUE
     AND s->>'unit' = 'actor_runs'
     AND COALESCE((s->>'remaining')::numeric, 0) > 0 THEN
    SELECT public.configure_gourrmet_runtime_crons(true, array['enrichment']::text[]) INTO e;
    RAISE NOTICE 'enrichment=%', e;
  ELSE
    RAISE NOTICE 'enrichment NOT enabled';
  END IF;
END $$;
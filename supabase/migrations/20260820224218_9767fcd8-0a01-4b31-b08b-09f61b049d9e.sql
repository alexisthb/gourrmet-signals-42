DO $$
DECLARE a jsonb; b jsonb;
BEGIN
  SELECT public.configure_gourrmet_runtime_crons(true, array['pappers']::text[]) INTO a;
  SELECT public.configure_pappers_recovery_cron(true) INTO b;
  RAISE NOTICE 'pappers=% recovery=%', a, b;
END $$;
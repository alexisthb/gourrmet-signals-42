DO $$
DECLARE
  f record;
  n integer := 0;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND l.lanname IN ('sql', 'plpgsql')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_catalog', f.signature);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'search_path épinglé sur % fonction(s) publique(s)', n;
END $$;
-- Fix : cron_state_run_start n'ecrivait pas malgre les runs reussis du cron.
--
-- Constat (diagnostic Lovable, 17/05) :
--   - pg_cron `scan-every-4-hours` tourne toutes les 4h, status=succeeded
--   - scan_logs montre des entries 'completed' (40 articles -> 2 signaux)
--   - signals.detected_at est bien recent (88 cette semaine)
--   - MAIS cron_state.last_run_at reste NULL pour scan-every-4-hours
--
-- Cause : run-full-scan appelle cron_state_run_start via supabase.rpc.
-- La fonction recreee en PR #5 (migration 20260517220000) etait en LANGUAGE
-- plpgsql SANS SECURITY DEFINER. Du coup l'UPDATE sur cron_state (table
-- protegee par RLS) tournait avec les droits du caller. Selon le contexte
-- d'appel (Edge Function avec service_role + supabase.rpc) la RLS peut
-- bloquer en silence -- d'autant plus que l'appel cote run-full-scan est
-- en best-effort (.then(() => {}, (err) => console.warn(...))) donc l'erreur
-- n'a jamais remonte.
--
-- Fix : redeclarer les deux helpers en SECURITY DEFINER pour qu'ils bypassent
-- la RLS, et re-grant explicit sur service_role. La logique applicative
-- (interdiction des lignes fantomes) reste identique.

CREATE OR REPLACE FUNCTION cron_state_run_start(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cron_state
  SET last_run_at = NOW(),
      last_run_status = 'running',
      last_error = NULL,
      updated_at = NOW()
  WHERE job_name = p_job_name;

  IF NOT FOUND THEN
    RAISE WARNING 'cron_state_run_start: unknown job_name %, ignoring (add it to cron_state seed if legitimate)', p_job_name;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cron_state_run_end(
  p_job_name TEXT,
  p_status TEXT,
  p_duration_ms INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE cron_state
  SET last_run_status = p_status,
      last_run_duration_ms = p_duration_ms,
      last_error = p_error,
      next_run_at = COALESCE(public.compute_next_cron_run(schedule, NOW()), next_run_at),
      updated_at = NOW()
  WHERE job_name = p_job_name;

  IF NOT FOUND THEN
    RAISE WARNING 'cron_state_run_end: unknown job_name %, ignoring', p_job_name;
  END IF;
END;
$$;

-- Re-grant explicit (CREATE OR REPLACE en theorie preserve les GRANT mais on
-- s'assure ici qu'il n'y a pas de regression silencieuse sur les permissions).
REVOKE EXECUTE ON FUNCTION cron_state_run_start(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION cron_state_run_end(TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cron_state_run_start(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cron_state_run_end(TEXT, TEXT, INT, TEXT) TO service_role;

-- Backfill : tag scan-every-4-hours comme s'il venait de tourner (le pg_cron
-- vient effectivement de finir un run avec succes). Permet a la SyncStatusBar
-- d'afficher une derniere synchro coherente immediatement apres le deploy,
-- sans attendre le prochain tick du cron.
UPDATE cron_state
SET last_run_at = NOW(),
    last_run_status = 'completed',
    last_error = NULL,
    next_run_at = COALESCE(public.compute_next_cron_run(schedule, NOW()), next_run_at),
    updated_at = NOW()
WHERE job_name IN ('scan-every-4-hours', 'pappers-scan-every-12h')
  AND last_run_at IS NULL;

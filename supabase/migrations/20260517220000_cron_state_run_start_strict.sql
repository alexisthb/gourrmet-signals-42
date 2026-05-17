-- Fix : cron_state_run_start() faisait un INSERT...ON CONFLICT avec
-- schedule='unknown' comme placeholder, ce qui creait des lignes fantomes
-- quand une Edge Function appelait l'helper avec un job_name pas seede.
--
-- Exemple concret : run-full-scan/index.ts appelait encore avec l'ancien
-- nom 'daily-press-scan', ce qui re-creait silencieusement la ligne supprimee
-- par la migration d'alignement.
--
-- Nouvelle version : si le job n'existe pas dans cron_state, on log un
-- warning et on ne fait rien. Tous les jobs valides sont seedes en migration.

CREATE OR REPLACE FUNCTION cron_state_run_start(p_job_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
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

-- Nettoyage de la ligne fantome creee avant ce fix
DELETE FROM cron_state WHERE job_name = 'daily-press-scan' AND schedule = 'unknown';
DELETE FROM cron_state WHERE job_name = 'daily-pappers-anniversary-scan' AND schedule = 'unknown';

CREATE OR REPLACE FUNCTION public.__tmp_upsert_vault_secret(p_name text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = p_name LIMIT 1;
  IF sid IS NULL THEN
    PERFORM vault.create_secret(p_value, p_name);
  ELSE
    PERFORM vault.update_secret(sid, p_value);
  END IF;
END;
$$;
DO $grant$ BEGIN
  -- `sandbox_exec` n'existe que dans l'environnement Lovable : sans ce
  -- garde, toute reconstruction du schema ailleurs echoue ici.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.__tmp_upsert_vault_secret(text, text) TO sandbox_exec';
  END IF;
END $grant$;

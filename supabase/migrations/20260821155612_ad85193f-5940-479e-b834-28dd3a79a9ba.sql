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
GRANT EXECUTE ON FUNCTION public.__tmp_upsert_vault_secret(text, text) TO sandbox_exec;
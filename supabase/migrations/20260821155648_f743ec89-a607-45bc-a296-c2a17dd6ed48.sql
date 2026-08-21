CREATE OR REPLACE FUNCTION public.__tmp_check_vault_secret(p_name text, p_value text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = p_name AND decrypted_secret = p_value);
$$;
GRANT EXECUTE ON FUNCTION public.__tmp_check_vault_secret(text, text) TO sandbox_exec;
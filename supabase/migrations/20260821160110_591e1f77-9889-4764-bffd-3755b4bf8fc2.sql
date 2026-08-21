CREATE OR REPLACE FUNCTION public.__tmp_bind_runtime_key(p_value text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n text; sid uuid; ok boolean;
BEGIN
  IF p_value IS NULL OR length(p_value) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_value');
  END IF;
  FOR n IN SELECT unnest(array['service_role_key','email_queue_service_role_key']) LOOP
    SELECT id INTO sid FROM vault.secrets WHERE name = n LIMIT 1;
    IF sid IS NULL THEN
      PERFORM vault.create_secret(p_value, n);
    ELSE
      PERFORM vault.update_secret(sid, p_value);
    END IF;
    sid := NULL;
  END LOOP;
  SELECT count(*) = 2 INTO ok FROM vault.decrypted_secrets
   WHERE name IN ('service_role_key','email_queue_service_role_key') AND decrypted_secret = p_value;
  RETURN jsonb_build_object('ok', ok);
END;
$$;
REVOKE ALL ON FUNCTION public.__tmp_bind_runtime_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.__tmp_bind_runtime_key(text) TO service_role;
-- Socle minimal reproduisant ce que Supabase fournit avant toute migration.
-- Objectif : exécuter réellement la chaîne de migrations pour valider syntaxe,
-- dépendances et idempotence. Ce n'est PAS un clone de la prod : les objets
-- ci-dessous sont des doublures, et tout comportement runtime de pg_cron,
-- pg_net, pgmq ou Vault reste hors de portée de ce banc.

-- Rôles Supabase
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin LOGIN SUPERUSER;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS pgmq;

-- Extensions réellement disponibles hors Supabase
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- auth
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('request.jwt.claim.role', true), 'postgres')
$$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.email', true), '')
$$;

-- ------------------------------------------------------------- storage
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT string_to_array(name, '/')
$$;

-- ---------------------------------------------------------------- cron
-- Doublure de pg_cron : la table `job` et les deux fonctions suffisent à
-- exécuter et à relire les migrations qui planifient des tâches.
CREATE TABLE IF NOT EXISTS cron.job (
  jobid bigserial PRIMARY KEY,
  schedule text NOT NULL,
  command text NOT NULL,
  nodename text NOT NULL DEFAULT 'localhost',
  nodeport integer NOT NULL DEFAULT 5432,
  database text NOT NULL DEFAULT current_database(),
  username text NOT NULL DEFAULT current_user,
  active boolean NOT NULL DEFAULT true,
  jobname text UNIQUE
);

CREATE TABLE IF NOT EXISTS cron.job_run_details (
  runid bigserial PRIMARY KEY,
  jobid bigint,
  job_pid integer,
  database text,
  username text,
  command text,
  status text,
  return_message text,
  start_time timestamptz,
  end_time timestamptz
);

CREATE OR REPLACE FUNCTION cron.schedule(
  job_name text, schedule text, command text
) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  existing bigint;
BEGIN
  SELECT jobid INTO existing FROM cron.job WHERE jobname = job_name;
  IF existing IS NOT NULL THEN
    UPDATE cron.job SET schedule = $2, command = $3, active = true
    WHERE jobid = existing;
    RETURN existing;
  END IF;
  INSERT INTO cron.job (schedule, command, jobname)
  VALUES ($2, $3, job_name) RETURNING jobid INTO existing;
  RETURN existing;
END;
$$;

CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text)
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  new_id bigint;
BEGIN
  INSERT INTO cron.job (schedule, command) VALUES ($1, $2) RETURNING jobid INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobid = job_id;
  RETURN FOUND;
END;
$$;

-- ----------------------------------------------------------------- net
CREATE TABLE IF NOT EXISTS net._http_response (
  id bigserial PRIMARY KEY,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION net.http_post(
  url text,
  body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint
LANGUAGE sql AS $$
  SELECT 0::bigint
$$;

CREATE OR REPLACE FUNCTION net.http_get(
  url text,
  params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 5000
) RETURNS bigint
LANGUAGE sql AS $$
  SELECT 0::bigint
$$;

-- --------------------------------------------------------------- vault
CREATE TABLE IF NOT EXISTS vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text DEFAULT '',
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW vault.decrypted_secrets AS
  SELECT id, name, description, secret, secret AS decrypted_secret,
         created_at, updated_at
  FROM vault.secrets;

CREATE OR REPLACE FUNCTION vault.create_secret(
  new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO vault.secrets (name, description, secret)
  VALUES (new_name, new_description, new_secret)
  ON CONFLICT (name) DO UPDATE SET secret = EXCLUDED.secret, updated_at = now()
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION vault.update_secret(
  secret_id uuid, new_secret text DEFAULT NULL,
  new_name text DEFAULT NULL, new_description text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vault.secrets
  SET secret = coalesce(new_secret, secret),
      name = coalesce(new_name, name),
      description = coalesce(new_description, description),
      updated_at = now()
  WHERE id = secret_id;
END;
$$;

GRANT USAGE ON SCHEMA public, auth, storage, extensions, cron, net, vault
  TO anon, authenticated, service_role;

-- Supabase pose des privilèges PAR DÉFAUT sur tout objet créé dans `public` :
-- anon/authenticated/service_role reçoivent les GRANT de table, et c'est la
-- RLS qui filtre. Sans cette réplique, le banc refuse en « permission denied »
-- ce que la production filtre par policy — et les contrats qui se glissent
-- dans la peau d'un rôle (80_view_security) échouent pour une raison qui
-- n'existe pas en vrai. Les REVOKE explicites des migrations s'appliquent
-- APRÈS création, comme en production.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

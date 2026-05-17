-- GR-002: Flag `is_seed` pour distinguer les données de demo / mock des vraies.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE company_enrichment ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pappers_signals ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE linkedin_engagers ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_signals_is_seed ON signals(is_seed) WHERE is_seed = TRUE;
CREATE INDEX IF NOT EXISTS idx_contacts_is_seed ON contacts(is_seed) WHERE is_seed = TRUE;

CREATE OR REPLACE FUNCTION wipe_seed_data()
RETURNS TABLE (
  table_name TEXT,
  rows_deleted BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contacts BIGINT;
  v_enrichment BIGINT;
  v_signals BIGINT;
  v_pappers BIGINT;
  v_engagers BIGINT;
BEGIN
  DELETE FROM contacts WHERE is_seed = TRUE;
  GET DIAGNOSTICS v_contacts = ROW_COUNT;
  DELETE FROM company_enrichment WHERE is_seed = TRUE;
  GET DIAGNOSTICS v_enrichment = ROW_COUNT;
  DELETE FROM linkedin_engagers WHERE is_seed = TRUE;
  GET DIAGNOSTICS v_engagers = ROW_COUNT;
  DELETE FROM pappers_signals WHERE is_seed = TRUE;
  GET DIAGNOSTICS v_pappers = ROW_COUNT;
  DELETE FROM signals WHERE is_seed = TRUE;
  GET DIAGNOSTICS v_signals = ROW_COUNT;
  RETURN QUERY VALUES
    ('contacts', v_contacts),
    ('company_enrichment', v_enrichment),
    ('linkedin_engagers', v_engagers),
    ('pappers_signals', v_pappers),
    ('signals', v_signals);
END;
$$;

REVOKE EXECUTE ON FUNCTION wipe_seed_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wipe_seed_data() TO service_role;

CREATE OR REPLACE VIEW seed_data_count AS
SELECT
  (SELECT COUNT(*) FROM signals WHERE is_seed = TRUE) AS signals,
  (SELECT COUNT(*) FROM contacts WHERE is_seed = TRUE) AS contacts,
  (SELECT COUNT(*) FROM company_enrichment WHERE is_seed = TRUE) AS company_enrichment,
  (SELECT COUNT(*) FROM pappers_signals WHERE is_seed = TRUE) AS pappers_signals,
  (SELECT COUNT(*) FROM linkedin_engagers WHERE is_seed = TRUE) AS linkedin_engagers;

GRANT SELECT ON seed_data_count TO authenticated, service_role;
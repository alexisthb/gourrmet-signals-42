DROP INDEX IF EXISTS contacts_linkedin_url_unique;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_signal_linkedin_unique
  ON contacts (signal_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;
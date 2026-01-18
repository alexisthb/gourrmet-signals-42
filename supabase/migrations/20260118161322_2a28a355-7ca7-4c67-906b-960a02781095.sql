-- Ajouter un index unique sur linkedin_url pour éviter les doublons futurs
CREATE UNIQUE INDEX IF NOT EXISTS contacts_linkedin_url_unique 
ON contacts (linkedin_url) 
WHERE linkedin_url IS NOT NULL;
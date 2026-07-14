-- v2 LinkedIn : autoriser les nouveaux statuts d'enrichissement dans la contrainte CHECK.
--
-- Sans ça, les UPDATE status='linkedin_processing' / 'dropcontact_processing' de la voie v2
-- (dispatcher enrich-contacts-linkedin + poller cron-check-linkedin-enrich) étaient REJETÉS
-- en silence par la contrainte -> l'enregistrement restait figé en 'processing', runId jamais
-- stocké, aucun contact créé. Élargit la liste autorisée. Idempotent.
ALTER TABLE company_enrichment DROP CONSTRAINT IF EXISTS company_enrichment_status_check;
ALTER TABLE company_enrichment ADD CONSTRAINT company_enrichment_status_check
  CHECK (status = ANY (ARRAY['pending','processing','manus_processing','linkedin_processing','dropcontact_processing','completed','failed']));

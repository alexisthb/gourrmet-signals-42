-- Update check constraint on company_enrichment to include manus_processing
ALTER TABLE company_enrichment DROP CONSTRAINT IF EXISTS company_enrichment_status_check;
ALTER TABLE company_enrichment ADD CONSTRAINT company_enrichment_status_check 
  CHECK (status IN ('pending', 'processing', 'manus_processing', 'completed', 'failed'));

-- Update check constraint on signals to include manus_processing
ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_enrichment_status_check;
ALTER TABLE signals ADD CONSTRAINT signals_enrichment_status_check 
  CHECK (enrichment_status IN ('none', 'pending', 'processing', 'manus_processing', 'completed', 'failed'));
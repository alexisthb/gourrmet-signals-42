CREATE INDEX IF NOT EXISTS idx_signals_company_identity_key ON public.signals (public.normalize_company_identity_key(company_name));
CREATE INDEX IF NOT EXISTS idx_company_enrichment_resolved_url ON public.company_enrichment (signal_id) WHERE resolution_status = 'resolved' AND linkedin_company_url IS NOT NULL;
ANALYZE public.signals; ANALYZE public.company_enrichment;
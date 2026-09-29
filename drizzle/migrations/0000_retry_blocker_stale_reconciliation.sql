CREATE OR REPLACE FUNCTION public.contact_enrichment_retry_blocker(p_signal_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  enrichment public.company_enrichment%ROWTYPE;
  has_enrichment boolean := false;
  -- Au-delà de ce délai, une opération fournisseur non réconciliée est forcément
  -- terminée côté fournisseur (runs Apify < 1h, lots Dropcontact < 15 min) :
  -- elle ne peut plus être doublée, le réessai redevient sûr.
  stale_after constant interval := interval '2 hours';
  is_stale boolean := false;
BEGIN
  SELECT * INTO enrichment
  FROM public.company_enrichment
  WHERE signal_id = p_signal_id;
  has_enrichment := FOUND;
  is_stale := has_enrichment AND enrichment.updated_at < now() - stale_after;

  IF EXISTS (
    SELECT 1 FROM public.provider_usage_events usage
    WHERE usage.signal_id = p_signal_id
      AND usage.provider IN ('pappers', 'apify', 'dropcontact')
      AND usage.dispatch_status = 'unconfirmed'
      AND usage.created_at >= now() - stale_after
  ) THEN
    RETURN 'provider_dispatch_unconfirmed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pappers_credit_usage usage
    WHERE usage.details->>'signal_id' = p_signal_id::text
      AND usage.details->>'operation' = 'entreprise'
      AND usage.reservation_status IN ('reserved', 'uncertain')
  ) THEN
    RETURN 'pappers_outcome_uncertain';
  END IF;

  IF has_enrichment AND EXISTS (
    SELECT 1 FROM public.provider_quota_reservations reservation
    WHERE reservation.provider = 'apify'
      AND reservation.run_id = enrichment.id
      AND reservation.status = 'reserved'
      AND reservation.created_at >= now() - stale_after
  ) THEN
    RETURN 'apify_outcome_uncertain';
  END IF;

  IF has_enrichment AND NOT is_stale
     AND enrichment.status <> 'completed'
     AND (
       NULLIF(enrichment.raw_data->>'dropcontact_request_id', '') IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.provider_usage_events usage
         WHERE usage.signal_id = p_signal_id
           AND usage.provider = 'dropcontact'
           AND usage.operation = 'enrich_submit'
           AND usage.success = true
           AND NULLIF(usage.metadata->>'provider_request_id', '') IS NOT NULL
       )
     )
  THEN
    RETURN 'dropcontact_task_nonterminal';
  END IF;

  IF has_enrichment AND NOT is_stale
     AND enrichment.status <> 'completed'
     AND (
       NULLIF(enrichment.raw_data->>'apify_run_id', '') IS NOT NULL
       OR EXISTS (
         SELECT 1 FROM public.provider_usage_events usage
         WHERE usage.signal_id = p_signal_id
           AND usage.provider = 'apify'
           AND usage.operation = 'linkedin_employee_submit'
           AND usage.success = true
           AND NULLIF(usage.metadata->>'provider_request_id', '') IS NOT NULL
       )
     )
     AND NOT (
       enrichment.status = 'failed'
       AND NULLIF(enrichment.raw_data->>'failed_at', '') IS NOT NULL
       AND (
         enrichment.raw_data->>'outcome' IN (
           'apify_failed','apify_aborted','apify_timed-out','apify_timed_out',
           'apify_dataset_missing','apify_dataset_fetch_error','apify_dataset_proof_ambiguous',
           'operational_profiles_ambiguous','no_operational_profiles'
         )
         OR enrichment.raw_data->>'outcome' LIKE 'dropcontact_%'
       )
     )
  THEN
    RETURN 'apify_task_nonterminal';
  END IF;

  RETURN NULL;
END;
$function$;
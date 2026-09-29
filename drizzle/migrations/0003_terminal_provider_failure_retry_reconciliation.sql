CREATE OR REPLACE FUNCTION public.contact_enrichment_retry_blocker(
  p_signal_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  enrichment public.company_enrichment%ROWTYPE;
  has_enrichment boolean := false;
  stale_after constant interval := interval '2 hours';
  is_stale boolean := false;
  failed_at timestamptz := NULL;
  latest_confirmed_provider_event_at timestamptz := NULL;
  has_terminal_local_failure boolean := false;
BEGIN
  SELECT * INTO enrichment
  FROM public.company_enrichment
  WHERE signal_id = p_signal_id;
  has_enrichment := FOUND;
  is_stale := has_enrichment AND enrichment.updated_at < now() - stale_after;

  IF has_enrichment
     AND enrichment.status = 'failed'
     AND NULLIF(enrichment.raw_data->>'failed_at', '') IS NOT NULL
     AND (enrichment.raw_data->>'failed_at') ~ '^\d{4}-\d{2}-\d{2}T' THEN
    BEGIN
      failed_at := (enrichment.raw_data->>'failed_at')::timestamptz;
    EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN
      failed_at := NULL;
    END;
  END IF;

  SELECT max(COALESCE(usage.occurred_at, usage.created_at))
  INTO latest_confirmed_provider_event_at
  FROM public.provider_usage_events usage
  WHERE usage.signal_id = p_signal_id
    AND usage.provider IN ('pappers', 'apify', 'dropcontact')
    AND usage.dispatch_status = 'confirmed';

  has_terminal_local_failure := failed_at IS NOT NULL
    AND (
      latest_confirmed_provider_event_at IS NULL
      OR failed_at >= latest_confirmed_provider_event_at
    );

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
      AND usage.created_at >= now() - stale_after
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

  -- Une finalisation locale explicitement échouée après le dernier événement
  -- fournisseur confirmé clôt la tentative. Les protections ci-dessus restent
  -- prioritaires si un dispatch ou une réservation récente demeure incertain.
  IF has_terminal_local_failure THEN
    RETURN NULL;
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
$$;

COMMENT ON FUNCTION public.contact_enrichment_retry_blocker(uuid) IS
  'Bloque un nouveau coût fournisseur tant qu une opération récente est réellement incertaine; libère les échecs locaux terminaux écrits après le dernier événement fournisseur confirmé.';
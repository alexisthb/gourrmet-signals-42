CREATE OR REPLACE FUNCTION public.pappers_scan_has_ambiguous_request(p_scan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pappers_credit_usage usage
    WHERE usage.scan_id = p_scan_id
      AND usage.created_at >= now() - interval '2 hours'
      AND (
        usage.reservation_status = 'uncertain'
        OR (
          usage.reservation_status = 'reserved'
          AND coalesce(usage.details->>'dispatch_state', 'ambiguous') <> 'prepared'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.pappers_scan_has_ambiguous_request(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pappers_scan_has_ambiguous_request(uuid) TO service_role;

UPDATE public.pappers_scan_progress
SET status = 'failed',
    error_message = 'Clôturé : tentative Pappers ambiguë de plus de 2 h réconciliée',
    lease_token = NULL,
    lease_expires_at = NULL,
    heartbeat_at = now()
WHERE status = 'paused'
  AND error_message LIKE 'Réconciliation Pappers requise%'
  AND NOT public.pappers_scan_has_ambiguous_request(id);
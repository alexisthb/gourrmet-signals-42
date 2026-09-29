CREATE OR REPLACE VIEW public.company_identifications_pending WITH (security_invoker = true) AS
 SELECT s.id AS signal_id, s.company_name, s.source_name, s.signal_type, s.score, s.event_detail, s.detected_at,
    ce.resolution_status,
    (ce.resolution_provenance ->> 'reason'::text) AS resolution_reason,
    ce.error_message,
    ce.updated_at AS failed_at,
    COALESCE((ce.resolution_provenance -> 'candidates'::text), '[]'::jsonb) AS candidates,
    past.linkedin_url AS previously_resolved_url,
    past.chosen_name AS previously_resolved_name
   FROM company_enrichment ce
     JOIN signals s ON s.id = ce.signal_id
     LEFT JOIN LATERAL ( SELECT x.linkedin_url, x.chosen_name
           FROM ( SELECT 0 AS prio, r.resolved_at AS ts, r.linkedin_url, r.chosen_name
                   FROM company_identity_resolutions r
                  WHERE r.company_key = normalize_company_identity_key(s.company_name) AND r.decision = 'pinned'::text
                UNION ALL
                 SELECT 1, ce2.updated_at, ce2.linkedin_company_url,
                    COALESCE((((ce2.resolution_provenance -> 'candidates'::text) -> 0) ->> 'name'::text), s2.company_name)
                   FROM ( SELECT s2i.id, s2i.company_name FROM signals s2i
                          WHERE normalize_company_identity_key(s2i.company_name) = normalize_company_identity_key(s.company_name)
                            AND s2i.id <> s.id OFFSET 0) s2
                     JOIN company_enrichment ce2 ON ce2.signal_id = s2.id
                  WHERE ce2.resolution_status = 'resolved'::text AND ce2.linkedin_company_url IS NOT NULL) x
          ORDER BY x.prio, x.ts DESC
         LIMIT 1) past ON true
  WHERE ce.status = 'failed'::text
    AND ce.resolution_status = ANY (ARRAY['ambiguous'::text, 'rejected'::text])
    AND ce.resolution_technical_status = 'completed'::text
    AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.signal_id = ce.signal_id)
    AND NOT EXISTS (SELECT 1 FROM company_identity_resolutions r WHERE r.signal_id = ce.signal_id);
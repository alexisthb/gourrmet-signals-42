-- Keep unverifiable legacy email rows available for local audit while
-- excluding them from every delivery and CRM-conversion denominator.
-- This runs after operational_kpis, whose first view definition predates the
-- explicit kpi_eligible marker introduced by the email truth migration.

CREATE OR REPLACE VIEW public.email_delivery_metrics
WITH (security_invoker = true)
AS
WITH email AS (
  SELECT
    count(*) AS queued_or_attempted,
    count(*) FILTER (WHERE sent_at IS NOT NULL) AS provider_accepted,
    count(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
    count(*) FILTER (WHERE bounced_at IS NOT NULL) AS bounced,
    count(*) FILTER (WHERE complained_at IS NOT NULL) AS complained,
    NULL::bigint AS provider_tracked_replies,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    count(*) FILTER (WHERE status = 'suppressed') AS suppressed
  FROM public.emails_sent
  WHERE kpi_eligible = true
), delivered_contacts AS (
  SELECT DISTINCT email_row.contact_id
  FROM public.emails_sent AS email_row
  WHERE email_row.kpi_eligible = true
    AND email_row.delivered_at IS NOT NULL
    AND email_row.contact_id IS NOT NULL
), crm AS (
  SELECT
    count(*) AS delivered_contacts,
    count(*) FILTER (
      WHERE contact.outreach_status IN ('responded', 'meeting', 'converted')
    ) AS response_proxy_contacts,
    count(*) FILTER (
      WHERE contact.outreach_status = 'converted'
    ) AS converted_proxy_contacts
  FROM delivered_contacts
  JOIN public.contacts AS contact ON contact.id = delivered_contacts.contact_id
)
SELECT
  now() AS measured_at,
  email.queued_or_attempted,
  email.provider_accepted,
  email.delivered,
  email.bounced,
  email.complained,
  email.provider_tracked_replies,
  email.failed,
  email.suppressed,
  round(email.delivered::numeric / nullif(email.provider_accepted, 0), 4)
    AS delivery_rate,
  round(email.bounced::numeric / nullif(email.provider_accepted, 0), 4)
    AS bounce_rate,
  round(email.complained::numeric / nullif(email.provider_accepted, 0), 4)
    AS complaint_rate,
  NULL::numeric AS tracked_reply_rate,
  crm.delivered_contacts,
  crm.response_proxy_contacts,
  crm.converted_proxy_contacts,
  round(crm.response_proxy_contacts::numeric / nullif(crm.delivered_contacts, 0), 4)
    AS crm_response_proxy_rate,
  round(crm.converted_proxy_contacts::numeric / nullif(crm.delivered_contacts, 0), 4)
    AS crm_conversion_proxy_rate
FROM email CROSS JOIN crm;

COMMENT ON VIEW public.email_delivery_metrics IS
  'Délivrabilité fournisseur vérifiée et proxys CRM. Les réponses fournisseur restent NULL faute de webhook entrant; les lignes legacy_unverifiable sont exclues.';
REVOKE ALL ON public.email_delivery_metrics FROM anon, authenticated;
GRANT SELECT ON public.email_delivery_metrics TO service_role;
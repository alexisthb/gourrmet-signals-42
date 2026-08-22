CREATE OR REPLACE VIEW public.signal_expiry_preview AS
SELECT
  coalesce(
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'signal_expiry_days'), '"'), '')::integer, 60
  ) AS horizon_jours,
  count(*) FILTER (
    WHERE s.status = 'new'
      AND (now()::date - s.detected_at::date) > coalesce(
            nullif(btrim((SELECT value::text FROM public.settings
                           WHERE key = 'signal_expiry_days'), '"'), '')::integer, 60)
      AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
  ) AS archiverait,
  count(*) FILTER (
    WHERE s.status = 'new'
      AND (now()::date - s.detected_at::date) > coalesce(
            nullif(btrim((SELECT value::text FROM public.settings
                           WHERE key = 'signal_expiry_days'), '"'), '')::integer, 60)
      AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
  ) AS preserverait_car_ont_des_contacts,
  count(*) FILTER (WHERE s.status = 'new') AS signaux_actifs
FROM public.signals s;

REVOKE ALL ON public.signal_expiry_preview FROM PUBLIC, anon;
GRANT SELECT ON public.signal_expiry_preview TO service_role, authenticated;

COMMENT ON VIEW public.signal_expiry_preview IS
  'Ce que l horizon commercial ARCHIVERAIT et ce qu il PRESERVERAIT, en lecture '
  'seule. Existe parce que expire_stale_signals est reservee a service_role : '
  'sans cette vue, connaitre l intention de la regle exigeait le droit de '
  'l executer. Un chiffre eleve en "preserverait" n est PAS un oubli — ce sont '
  'les signaux porteurs de contacts deja payes, preserves deliberement.';

CREATE OR REPLACE VIEW public.enrichment_sweep_readiness AS
WITH reglages AS (
  SELECT coalesce(
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'enrichment_sweep_daily_dose'), '"'), '')::integer, 5
  ) AS dose
), soldes AS (
  SELECT
    coalesce((public.apify_actor_run_quota_status(now())->>'remaining')::integer, 0) AS apify_restant,
    coalesce((
      SELECT (e.metadata->>'credits_left')::integer
      FROM public.provider_usage_events e
      WHERE e.provider = 'dropcontact'
        AND jsonb_typeof(e.metadata->'credits_left') = 'number'
      ORDER BY e.occurred_at DESC
      LIMIT 1
    ), 0) AS dropcontact_restant
)
SELECT
  r.dose,
  s.apify_restant,
  s.dropcontact_restant,
  100 AS reserve_apify,
  150 AS reserve_dropcontact,
  (SELECT count(*) FROM public.enrichment_backlog
    WHERE situation LIKE 'JAMAIS DEMANDE%') AS candidats,
  CASE
    WHEN s.apify_restant < 100 + r.dose * 2 THEN
      'ABSTENTION — quota Apify sous la reserve (' || s.apify_restant || ' runs)'
    WHEN s.dropcontact_restant < 150 + r.dose * 4 THEN
      'ABSTENTION — solde Dropcontact sous la reserve (' || s.dropcontact_restant || ' credits)'
    WHEN (SELECT count(*) FROM public.enrichment_backlog
           WHERE situation LIKE 'JAMAIS DEMANDE%') = 0 THEN
      'RIEN A FAIRE — aucun signal en famine'
    ELSE 'PRET — le prochain balayage mettra en file jusqu a ' || r.dose || ' signaux'
  END AS verdict
FROM reglages r CROSS JOIN soldes s;

REVOKE ALL ON public.enrichment_sweep_readiness FROM PUBLIC, anon;
GRANT SELECT ON public.enrichment_sweep_readiness TO service_role, authenticated;

COMMENT ON VIEW public.enrichment_sweep_readiness IS
  'Ce que le balayage de famine fera au prochain declenchement, et ce qui le '
  'retient le cas echeant. « ABSTENTION » n est pas une panne : c est le '
  'garde-fou qui protege la capacite reservee aux signaux frais de la semaine. '
  'Sans cette vue, une abstention et un automate mort se ressemblent.';
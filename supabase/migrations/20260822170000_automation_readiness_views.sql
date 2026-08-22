-- RENDRE LES DEUX AUTOMATES INTERROGEABLES SANS LES RENDRE DÉCLENCHABLES.
--
-- Relevé le 2026-08-22 lors d'une vérification indépendante : trois contrôles
-- sur onze ont été rendus impossibles par un refus de droits. Deux d'entre eux
-- étaient un faux problème — `pipeline_health_summary` et
-- `apify_actor_run_quota_status` sont bien accordées à `authenticated`, et le
-- refus venait du rôle d'introspection propre à l'agent qui vérifiait.
--
-- Le troisième était réel. `expire_stale_signals` et `sweep_enrichment_famine`
-- sont réservées à `service_role`, et ce choix est juste : la première archive
-- des signaux en masse, la seconde engage une dépense fournisseur. Aucune ne
-- doit être déclenchable depuis un navigateur.
--
-- Mais un GRANT ne distingue pas les paramètres. `expire_stale_signals(60, true)`
-- est une simulation inoffensive ; `expire_stale_signals(60, false)` archive
-- 1 544 lignes. Les deux passent par le même droit d'exécution. Conséquence :
-- pour savoir ce que la règle FERAIT, il fallait le droit de la FAIRE.
--
-- C'est le pire compromis possible. Soit on élargit le droit et un clic malheureux
-- devient possible, soit on le garde et l'automate devient une boîte noire —
-- et un automate qu'on ne peut pas interroger est un automate qu'on cesse de
-- croire, puis qu'on débranche « au cas où ».
--
-- Ces deux vues coupent le nœud : elles rendent l'intention LISIBLE en lecture
-- seule, sans donner le moindre pouvoir d'exécution. Elles ne calculent rien de
-- nouveau — elles rejouent exactement les conditions des fonctions, ce qui les
-- rend utiles comme contrôle de cohérence autant que comme tableau de bord.

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

-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.enrichment_sweep_readiness AS
WITH reglages AS (
  SELECT coalesce(
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'enrichment_sweep_daily_dose'), '"'), '')::integer, 5
  ) AS dose
), soldes AS (
  SELECT
    coalesce((public.apify_actor_run_quota_status(now())->>'remaining')::integer, 0) AS apify_restant,
    -- On lit la SOURCE (`provider_usage_events`) plutôt que la vue
    -- `dropcontact_balance_metrics`, bien qu'elle expose exactement ce chiffre.
    --
    -- Motif : une vue qui en référence une autre crée une dépendance qui BLOQUE
    -- le `DROP VIEW` de la seconde. La migration 20260820212157 supprime et
    -- recrée `dropcontact_balance_metrics` ; s'appuyer dessus faisait échouer
    -- tout rejeu de la chaîne de migrations — constaté au banc, en rouge.
    -- Une fonction, elle, ne crée pas cette dépendance : `sweep_enrichment_famine`
    -- peut donc continuer de lire la vue sans risque.
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
  -- Les mêmes constantes que dans `sweep_enrichment_famine` : 2 runs et 4
  -- crédits par signal, réserves de 100 et 150 gardées pour les signaux frais.
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

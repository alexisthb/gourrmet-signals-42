-- LES CINQ VUES QUI IGNORAIENT LA CONVENTION DU DÉPÔT.
--
-- Le scan de sécurité du 2026-08-22 pointe cinq vues « Security Definer » :
-- `pipeline_health`, `personas_health`, `enrichment_backlog`,
-- `signal_expiry_preview`, `enrichment_sweep_readiness`. Ce sont exactement
-- les cinq vues créées ces dernières vingt-quatre heures — les vingt vues
-- antérieures du projet portent toutes `security_invoker = true`. La
-- convention existait ; elle a été manquée cinq fois de suite par le même
-- auteur. La présente migration corrige, et le contrat 80 rend la convention
-- MÉCANIQUE : une sixième vue definer fera échouer le banc au lieu de
-- réapparaître dans un scan.
--
-- POURQUOI CE N'EST PAS UN SIMPLE ALTER × 5.
--
-- En mode invoker, la vue s'exécute avec les droits de CELUI QUI LA CONSULTE.
-- Or `provider_usage_events` porte une policy SELECT réservée aux rôles
-- admin/super_admin (durcissement du 20/08). Deux des cinq vues la lisent
-- directement. Les basculer telles quelles ne casserait RIEN de visible :
-- pour un compte non-admin, la RLS filtrerait simplement toutes les lignes,
-- et les vues afficheraient des zéros.
--
--   `pipeline_health` montrerait « appels_fournisseurs : MUETTE » ;
--   `enrichment_sweep_readiness` verrait un solde Dropcontact à 0 et
--   s'annoncerait en ABSTENTION.
--
-- Des chiffres FAUX, sans une erreur nulle part — le motif exact contre
-- lequel ces vues ont été construites. Un tableau de bord qui ment sur son
-- propre périmètre est pire que pas de tableau de bord.
--
-- La sortie est le modèle déjà établi ici par `apify_actor_run_quota_status` :
-- l'agrégat sensible s'expose par une fonction SECURITY DEFINER au périmètre
-- LE PLUS ÉTROIT POSSIBLE — des compteurs, jamais les lignes. Un compte
-- authentifié peut savoir « combien d'appels fournisseurs ont réussi en 24 h »
-- sans pouvoir lire une seule ligne de télémétrie brute.

-- ─────────────────────────────────────────────────────────────────────────────
-- Les deux agrégats étroits.

CREATE OR REPLACE FUNCTION public.provider_calls_pulse_24h()
RETURNS TABLE (executions bigint, produit bigint, derniere_execution timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT
    count(*) FILTER (WHERE occurred_at > now() - interval '24 hours'),
    count(*) FILTER (WHERE occurred_at > now() - interval '24 hours' AND success),
    max(occurred_at)
  FROM public.provider_usage_events;
$$;

REVOKE ALL ON FUNCTION public.provider_calls_pulse_24h() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_calls_pulse_24h() TO service_role, authenticated;

COMMENT ON FUNCTION public.provider_calls_pulse_24h() IS
  'Trois compteurs de sante des appels fournisseurs sur 24 h. SECURITY DEFINER '
  'a dessein : provider_usage_events est reservee aux admins, mais SAVOIR que '
  'la chaine tourne n est pas lire la telemetrie. Perimetre volontairement '
  'reduit a des agregats — jamais les lignes.';

CREATE OR REPLACE FUNCTION public.latest_dropcontact_credits()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT (e.metadata->>'credits_left')::integer
  FROM public.provider_usage_events e
  WHERE e.provider = 'dropcontact'
    AND jsonb_typeof(e.metadata->'credits_left') = 'number'
  ORDER BY e.occurred_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.latest_dropcontact_credits() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.latest_dropcontact_credits() TO service_role, authenticated;

COMMENT ON FUNCTION public.latest_dropcontact_credits() IS
  'Dernier solde Dropcontact rapporte par le fournisseur — UN entier, rien '
  'd autre. SECURITY DEFINER car la table source est reservee aux admins ; le '
  'solde, lui, conditionne le verdict du balayage de famine que tout operateur '
  'doit pouvoir lire.';

-- ─────────────────────────────────────────────────────────────────────────────
-- `pipeline_health`, recréée à l'identique — colonnes inchangées, même ordre
-- (CREATE OR REPLACE VIEW ne sait pas réordonner) — au seul remplacement près :
-- le bloc `appels` passe par l'agrégat au lieu de lire la table.

CREATE OR REPLACE VIEW public.pipeline_health
WITH (security_invoker = on) AS
WITH presse AS (
  SELECT
    'presse' AS chaine,
    count(*) FILTER (WHERE started_at > now() - interval '24 hours') AS executions,
    count(*) FILTER (WHERE started_at > now() - interval '24 hours'
                       AND coalesce(articles_fetched, 0) > 0) AS produit,
    max(started_at) AS derniere_execution
  FROM public.scan_logs
),
contacts AS (
  SELECT
    'contacts' AS chaine,
    count(*) FILTER (WHERE coalesce(finished_at, updated_at) > now() - interval '24 hours') AS executions,
    count(*) FILTER (
      WHERE coalesce(finished_at, updated_at) > now() - interval '24 hours'
        AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = j.signal_id)
    ) AS produit,
    max(coalesce(finished_at, updated_at)) AS derniere_execution
  FROM public.enrichment_jobs j
  WHERE job_type = 'contacts' AND status IN ('completed', 'failed')
),
logos AS (
  SELECT
    'logos' AS chaine,
    count(*) FILTER (WHERE logo_last_attempt_at > now() - interval '24 hours') AS executions,
    count(*) FILTER (
      WHERE logo_last_attempt_at > now() - interval '24 hours'
        AND company_logo_url IS NOT NULL
    ) AS produit,
    max(logo_last_attempt_at) AS derniere_execution
  FROM public.signals
),
appels AS (
  -- Via l'agrégat DEFINER : la policy admin-only de provider_usage_events ne
  -- doit pas rendre cette ligne « MUETTE » pour un opérateur non-admin.
  SELECT
    'appels_fournisseurs' AS chaine,
    p.executions,
    p.produit,
    p.derniere_execution
  FROM public.provider_calls_pulse_24h() p
)
SELECT
  chaine,
  executions,
  produit,
  CASE WHEN executions > 0
       THEN round(100.0 * produit / executions, 1)
       ELSE NULL END AS rendement_pct,
  derniere_execution,
  CASE
    WHEN executions = 0 THEN 'MUETTE — aucune execution en 24h'
    WHEN produit = 0 THEN 'TUYAU VIDE — ' || executions || ' executions, 0 resultat'
    WHEN executions >= 10 AND (100.0 * produit / executions) < 15 THEN
      'RENDEMENT FAIBLE — ' || round(100.0 * produit / executions, 1) || '%'
    ELSE 'OK'
  END AS verdict
FROM (
  SELECT * FROM presse UNION ALL
  SELECT * FROM contacts UNION ALL
  SELECT * FROM logos UNION ALL
  SELECT * FROM appels
) t
ORDER BY
  CASE
    WHEN executions = 0 THEN 0
    WHEN produit = 0 THEN 1
    ELSE 2
  END,
  chaine;

REVOKE ALL ON public.pipeline_health FROM PUBLIC, anon;
GRANT SELECT ON public.pipeline_health TO service_role, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- `enrichment_sweep_readiness`, recréée : le solde Dropcontact passe par
-- l'agrégat. Les constantes restent celles de `sweep_enrichment_famine`.

CREATE OR REPLACE VIEW public.enrichment_sweep_readiness
WITH (security_invoker = on) AS
WITH reglages AS (
  SELECT coalesce(
    nullif(btrim((SELECT value::text FROM public.settings
                   WHERE key = 'enrichment_sweep_daily_dose'), '"'), '')::integer, 5
  ) AS dose
), soldes AS (
  SELECT
    coalesce((public.apify_actor_run_quota_status(now())->>'remaining')::integer, 0) AS apify_restant,
    coalesce(public.latest_dropcontact_credits(), 0) AS dropcontact_restant
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

-- ─────────────────────────────────────────────────────────────────────────────
-- Les trois autres ne lisent que des tables couvertes par des policies
-- authenticated (settings, signals, contacts, company_enrichment,
-- enrichment_jobs) : un ALTER suffit, aucune redéfinition.

ALTER VIEW public.personas_health SET (security_invoker = on);
ALTER VIEW public.enrichment_backlog SET (security_invoker = on);
ALTER VIEW public.signal_expiry_preview SET (security_invoker = on);
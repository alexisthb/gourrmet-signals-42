-- LA LEÇON DES DIX-SEPT HEURES, RENDUE AUTOMATIQUE.
--
-- Le 2026-08-20, six chaînes métier sur sept étaient mortes pendant 17 heures.
-- 1 135 appels cron rejetés en 401. Et `cron.job_run_details` affichait
-- « succeeded » du début à la fin, parce qu'il mesure si l'ordre a été DONNÉ,
-- jamais s'il a produit quelque chose.
--
-- Le 2026-08-21, le même aveuglement s'est reproduit sous une autre forme : un
-- filtre de titres envoyé à Apify vidait les datasets. Les runs réussissaient,
-- le dataset revenait vide, le tableau de bord restait vert. Vingt-deux
-- enrichissements sur vingt-sept n'ont ramené aucun contact.
--
-- Deux fois le même motif : UNE CHAÎNE QUI TOURNE N'EST PAS UNE CHAÎNE QUI
-- PRODUIT. Or la seule parade issue de ces incidents était, jusqu'ici, une
-- requête SQL à copier-coller depuis une note d'incident — c'est-à-dire une
-- vigilance humaine, exactement ce qui a manqué les deux fois.
--
-- Cette vue mesure le RENDEMENT de chaque chaîne, pas son activité. Elle est
-- conçue pour être lue par un humain pressé : une ligne par chaîne, un verdict
-- en clair, et le chiffre qui le motive.
--
-- Ce qu'elle ne fait pas, volontairement : elle n'envoie pas d'email et ne
-- coupe rien. Un garde-fou qui coupe une chaîne sur un faux positif coûte plus
-- cher que le silence qu'il remplace. Elle rend l'anomalie LISIBLE en une
-- requête ; la décision reste humaine.

CREATE OR REPLACE VIEW public.pipeline_health AS
WITH presse AS (
  -- On compte les scans QUI ONT PRODUIT, pas les articles : rapporter des
  -- articles à des scans donnerait « 9366 % », un chiffre qui ne veut rien dire
  -- et qu'un lecteur pressé prendrait pour une santé éclatante. Le rendement
  -- doit toujours être « combien d'exécutions ont abouti sur combien ».
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
  SELECT
    'appels_fournisseurs' AS chaine,
    count(*) FILTER (WHERE occurred_at > now() - interval '24 hours') AS executions,
    count(*) FILTER (WHERE occurred_at > now() - interval '24 hours' AND success) AS produit,
    max(occurred_at) AS derniere_execution
  FROM public.provider_usage_events
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
    -- Une chaîne qui n'a pas tourné du tout : ce n'est pas un rendement nul,
    -- c'est une absence. Les deux se soignent différemment.
    WHEN executions = 0 THEN 'MUETTE — aucune execution en 24h'
    -- LE CAS DES DIX-SEPT HEURES : ça tourne, ça ne produit rien.
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

COMMENT ON VIEW public.pipeline_health IS
  'Rendement de chaque chaine metier sur 24h — combien d executions, combien de '
  'RESULTATS. Repond a la question que cron.job_run_details ne pose pas : la '
  'chaine produit-elle ? Verdicts : MUETTE (rien ne tourne), TUYAU VIDE (ca '
  'tourne sans produire — le defaut des 17 heures du 2026-08-20 et du filtre '
  'de titres du 2026-08-21), RENDEMENT FAIBLE, OK.';

-- ─────────────────────────────────────────────────────────────────────────────
-- La même chose en une seule ligne, pour un humain qui n'a pas trente secondes.

CREATE OR REPLACE FUNCTION public.pipeline_health_summary()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN count(*) FILTER (WHERE verdict LIKE 'TUYAU VIDE%') > 0
      THEN 'ALERTE — tuyau vide : ' || string_agg(chaine, ', ') FILTER (WHERE verdict LIKE 'TUYAU VIDE%')
    WHEN count(*) FILTER (WHERE verdict LIKE 'MUETTE%') > 0
      THEN 'ALERTE — chaine muette : ' || string_agg(chaine, ', ') FILTER (WHERE verdict LIKE 'MUETTE%')
    WHEN count(*) FILTER (WHERE verdict LIKE 'RENDEMENT FAIBLE%') > 0
      THEN 'VIGILANCE — rendement faible : ' || string_agg(chaine, ', ') FILTER (WHERE verdict LIKE 'RENDEMENT FAIBLE%')
    ELSE 'OK — les ' || count(*) || ' chaines produisent'
  END
  FROM public.pipeline_health;
$$;

REVOKE ALL ON FUNCTION public.pipeline_health_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pipeline_health_summary() TO service_role, authenticated;

COMMENT ON FUNCTION public.pipeline_health_summary() IS
  'Verdict d une ligne sur la sante des chaines. A lire en premier apres tout '
  'changement touchant une entree fournisseur ou une mise en service.';

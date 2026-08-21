-- Un signal peut épuiser ses tentatives de logo AVANT que l'enrichissement
-- n'ait trouvé le site de l'entreprise. Quand le domaine arrive enfin, le logo
-- devient trouvable — mais le compteur de tentatives le condamne définitivement.
--
-- Mesuré en production le 2026-08-21 : 278 signaux de score >= 4 sans logo,
-- tous à 5 tentatives sur 5. Ce sont des prospects à fort score que
-- l'opératrice voit sans identité visuelle, et pour lesquels aucun visuel
-- cadeau n'est générable.
--
-- Cette fonction remplace la sélection faite en PostgREST par la fonction edge,
-- qui ne savait pas exprimer la condition « une piste fraîche est apparue ».
--
-- PROPRIÉTÉ IMPORTANTE — la reprise ne peut pas boucler : une nouvelle
-- tentative écrit `logo_last_attempt_at = now()`, ce qui rend immédiatement
-- fausse la condition `enrichment.updated_at > logo_last_attempt_at`. Un signal
-- épuisé n'est donc réessayé qu'UNE fois par nouvelle information, jamais en
-- boucle. C'est ce qui distingue cette reprise d'une remise à zéro aveugle des
-- compteurs, qui rebrûlerait 5 tentatives sur exactement les mêmes échecs.
CREATE OR REPLACE FUNCTION public.select_logo_candidates(
  p_limit integer DEFAULT 15,
  p_min_score integer DEFAULT 0,
  p_max_attempts integer DEFAULT 5,
  p_backoff_hours integer DEFAULT 2
)
RETURNS TABLE (
  id uuid,
  company_name text,
  logo_fetch_attempts integer,
  selection_reason text,
  enrichment_domain text,
  enrichment_website text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  WITH piste AS (
    SELECT ce.signal_id,
           max(ce.updated_at)                            AS derniere_maj,
           (array_agg(ce.domain  ORDER BY ce.updated_at DESC)
              FILTER (WHERE ce.domain IS NOT NULL))[1]   AS domaine,
           (array_agg(ce.website ORDER BY ce.updated_at DESC)
              FILTER (WHERE ce.website IS NOT NULL))[1]  AS site
    FROM public.company_enrichment ce
    WHERE coalesce(ce.domain, ce.website) IS NOT NULL
    GROUP BY ce.signal_id
  )
  SELECT s.id,
         s.company_name,
         coalesce(s.logo_fetch_attempts, 0) AS logo_fetch_attempts,
         CASE
           WHEN coalesce(s.logo_fetch_attempts, 0) = 0 THEN 'jamais_tente'
           WHEN coalesce(s.logo_fetch_attempts, 0) < p_max_attempts THEN 'tentatives_restantes'
           ELSE 'piste_fraiche_apres_epuisement'
         END AS selection_reason,
         piste.domaine,
         piste.site
  FROM public.signals s
  LEFT JOIN piste ON piste.signal_id = s.id
  WHERE s.company_logo_url IS NULL
    AND s.logo_manus_task_id IS NULL
    AND s.status NOT IN ('ignored', 'lost')
    AND coalesce(s.score, 0) >= p_min_score
    AND (
      -- Cas nominal : il reste des tentatives et le backoff est respecté.
      (
        coalesce(s.logo_fetch_attempts, 0) < p_max_attempts
        AND (
          s.logo_last_attempt_at IS NULL
          OR s.logo_last_attempt_at < now() - make_interval(hours => p_backoff_hours)
        )
      )
      OR
      -- Cas de reprise : tentatives épuisées, MAIS l'enrichissement a produit un
      -- domaine ou un site APRÈS le dernier essai. L'information est neuve, donc
      -- l'échec précédent ne prouve plus rien.
      (
        coalesce(s.logo_fetch_attempts, 0) >= p_max_attempts
        AND piste.derniere_maj IS NOT NULL
        AND piste.derniere_maj > coalesce(s.logo_last_attempt_at, '-infinity'::timestamptz)
      )
    )
  ORDER BY
    -- Les jamais-tentés d'abord : un signal neuf ne doit jamais attendre
    -- derrière une reprise. Puis les plus anciennement tentés, puis les plus
    -- récemment détectés.
    (coalesce(s.logo_fetch_attempts, 0) = 0) DESC,
    s.logo_last_attempt_at ASC NULLS FIRST,
    s.detected_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 15), 100));
$$;

REVOKE ALL ON FUNCTION public.select_logo_candidates(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_logo_candidates(integer, integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.select_logo_candidates(integer, integer, integer, integer) IS
  'Candidats à la récupération de logo. Inclut les signaux dont les tentatives '
  'sont épuisées lorsqu''un domaine ou un site est apparu depuis leur dernier '
  'essai — sans jamais boucler, la tentative suivante refermant la condition.';

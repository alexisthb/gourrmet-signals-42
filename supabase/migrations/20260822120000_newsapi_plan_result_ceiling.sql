-- LE PLAFOND DE RÉSULTATS DU PLAN NEWSAPI, EN DONNÉE PLUTÔT QU'EN CONSTANTE.
--
-- Mesuré le 2026-08-22 : chaque scan `scan-every-4-hours` se terminait en
-- `failed` — « Fetch partiel: 1 page(s) en échec » — alors qu'il produisait
-- normalement ses articles et ses signaux.
--
-- La cause tient en une ligne. `computeNextCheckpoint` plafonnait la pagination
-- à 10 000 résultats, qui est la limite du plan *Business* de NewsAPI. Le compte
-- Gourrmet est sur le plan *Developer*, où `everything` n'expose QUE les 100
-- premiers résultats. Une requête sur 28 — « Rebranding - Nouvelle identité » —
-- a ramené une page 1 pleine (100 articles). Le code en a déduit qu'une page 2
-- existait. NewsAPI a répondu HTTP 426 (Upgrade Required). Et comme la branche
-- d'erreur réécrit `next_page` à la page qui vient d'échouer, le curseur s'est
-- figé sur la page 2 : chaque scan depuis retentait la même page condamnée.
--
-- Trois symptômes pour une seule cause :
--   1. un scan sain marqué `failed` toutes les 4 heures ;
--   2. une requête de veille sur 28 qui ne collecte plus rien depuis hier 20:00 ;
--   3. une requête gaspillée par scan sur un budget quotidien de 100.
--
-- POURQUOI UNE COLONNE ET NON UNE CONSTANTE : `daily_requests` était déjà ici,
-- et `plan_name` aussi. Le plafond de résultats est la troisième propriété du
-- même plan commercial ; l'enfouir dans le code condamnait à un déploiement le
-- jour d'une montée d'abonnement. Ici, c'est un UPDATE.
--
-- La valeur par défaut est celle du plan réellement souscrit — 100 — et non une
-- valeur permissive : sur ce projet, un défaut trop large ne se voit pas, il
-- se paie en requêtes brûlées et en scans faussement en échec.

ALTER TABLE public.newsapi_plan_settings
  ADD COLUMN IF NOT EXISTS max_results_per_query integer NOT NULL DEFAULT 100;

-- Un plafond nul ou négatif désarmerait la pagination sans rien signaler.
ALTER TABLE public.newsapi_plan_settings
  DROP CONSTRAINT IF EXISTS newsapi_plan_max_results_positive;
ALTER TABLE public.newsapi_plan_settings
  ADD CONSTRAINT newsapi_plan_max_results_positive
  CHECK (max_results_per_query > 0);

COMMENT ON COLUMN public.newsapi_plan_settings.max_results_per_query IS
  'Nombre maximal de resultats que le plan expose pour UNE requete everything. '
  'Developer = 100, Business = 10000. Depasser ce plafond fait repondre NewsAPI '
  'HTTP 426 : la page est refusee, le curseur se fige, et le scan est marque en '
  'echec alors qu il a produit. A mettre a jour en meme temps que daily_requests '
  'lors d un changement d abonnement.';

-- Le plan Developer est celui souscrit au 2026-08-22. On aligne explicitement
-- les lignes existantes plutôt que de se fier au DEFAULT, qui ne s'applique
-- qu'aux colonnes nouvellement créées et laisserait une future ligne à 100 même
-- après une montée de plan.
UPDATE public.newsapi_plan_settings
SET max_results_per_query = 100, updated_at = now()
WHERE plan_name = 'Developer' AND max_results_per_query <> 100;

-- ─────────────────────────────────────────────────────────────────────────────
-- LE CURSEUR FIGÉ.
--
-- Le correctif de code empêche d'en créer un nouveau ; il ne défige pas celui
-- qui existe déjà, puisque le curseur est lu depuis la dernière ligne de
-- `newsapi_usage` et vaut `next_page = 2` depuis hier 20:00.
--
-- On pose donc une ligne de curseur à la page 1. `resolveNewsApiCursor` lit la
-- ligne la PLUS RÉCENTE : cette insertion redonne la main au prochain scan.

-- `requests_count` à 0 : cette ligne est un curseur, pas un appel. Elle ne doit
-- rien consommer du budget quotidien de 100 requêtes.
INSERT INTO public.newsapi_usage (query_id, requests_count, articles_fetched, details)
SELECT
  u.query_id,
  0,
  0,
  jsonb_build_object(
    'status', 'cursor_reset',
    'page', 1,
    'next_page', 1,
    'window_from', u.details->>'window_from',
    'window_to', u.details->>'window_to',
    'reason', 'Plafond du plan Developer atteint : la page 2 n existe pas. '
              'Curseur remis en page 1 (migration 20260822120000).'
  )
FROM (
  SELECT DISTINCT ON (query_id) query_id, details, created_at
  FROM public.newsapi_usage
  ORDER BY query_id, created_at DESC
) u
WHERE coalesce((u.details->>'next_page')::int, 1) > 1;

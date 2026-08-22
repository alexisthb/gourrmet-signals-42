-- LE PLAFOND APIFY, RECALIBRÉ SUR LE BUDGET QU'IL EST CENSÉ REPRÉSENTER.
--
-- Mesuré le 2026-08-22 par l'autorité de quota elle-même
-- (`apify_actor_run_quota_status`) : used 151, limit 200, remaining 49, période
-- close au 31 août. Chaque entreprise enrichie consomme DEUX runs — la
-- recherche d'employés, puis l'étage profils. Il restait donc de quoi traiter
-- environ 24 entreprises pour les neuf derniers jours du mois, alors que la
-- seule voie Pappers produit une dizaine de signaux par jour.
--
-- L'enrichissement se serait arrêté en milieu de semaine, proprement et
-- silencieusement : le garde-fou aurait refusé les réservations, les signaux
-- seraient restés sans contacts, et rien dans l'interface n'aurait expliqué
-- pourquoi. Exactement le motif que cette plateforme a déjà payé deux fois.
--
-- POURQUOI LE PLAFOND ÉTAIT FAUX, ET NON SIMPLEMENT ATTEINT.
--
-- `plan_name` vaut « Budget 200 USD/mois » : les 200 sont des DOLLARS. Mais la
-- colonne qui borne réellement, `monthly_run_limit`, vaut elle aussi 200 — en
-- RUNS. Les deux unités ont été confondues au moment du réglage. Or la dépense
-- mesurée sur `provider_usage_events` pour le mois d'août est de 6,40 $ pour
-- 151 runs. Le garde-fou coupait donc à ~3 % du budget qu'il devait protéger.
--
-- L'ARITHMÉTIQUE DU NOUVEAU PLAFOND, ET SON INCERTITUDE ASSUMÉE.
--
-- 301 des 354 événements Apify du mois ne portent AUCUN coût enregistré : le
-- 6,40 $ ne couvre que les 53 événements tarifés. Le coût unitaire réel est
-- donc encadré, pas connu :
--   • hypothèse basse  — 6,40 $ couvrent tout : 0,042 $/run → 600 runs ≈ 25 $
--   • hypothèse haute  — 0,12 $/run (les 53 tarifés) → 600 runs ≈ 72 $
--   • montage à deux étages mesuré le 21/08 : ~0,33 $/entreprise, soit
--     ~0,165 $/run → 600 runs ≈ 99 $
--
-- 600 runs restent sous le budget de 200 $ dans les TROIS hypothèses, y compris
-- la plus pessimiste. On ne relève donc pas « au maximum possible » : on relève
-- jusqu'au point où même l'hypothèse la plus défavorable tient dans le budget.
--
-- Arbitré avec Alexis le 2026-08-22.
--
-- Ce que cette migration NE fait pas : supprimer le plafond. Un garde-fou à 600
-- reste un garde-fou. La leçon du 21/08 — 147 runs consommés en une journée
-- d'essais — est précisément qu'une borne haute doit exister.

UPDATE public.apify_plan_settings
SET monthly_run_limit = 600,
    plan_name = 'Budget 200 USD/mois (plafond 600 runs)',
    updated_at = now()
WHERE monthly_run_limit = 200;

-- Le plafond doit rester une borne réelle : 0 ou négatif désarmerait la
-- réservation de quota sans que rien ne le signale.
ALTER TABLE public.apify_plan_settings
  DROP CONSTRAINT IF EXISTS apify_monthly_run_limit_positive;
ALTER TABLE public.apify_plan_settings
  ADD CONSTRAINT apify_monthly_run_limit_positive
  CHECK (monthly_run_limit > 0);

COMMENT ON COLUMN public.apify_plan_settings.monthly_run_limit IS
  'Plafond MENSUEL en RUNS d acteur — pas en dollars. Chaque entreprise '
  'enrichie en consomme DEUX (recherche d employes, puis etage profils). Ne pas '
  'confondre avec plan_name, qui exprime un budget en USD. Relever ce plafond '
  'engage une depense : verifier la depense mesuree sur provider_usage_events '
  'avant tout changement.';

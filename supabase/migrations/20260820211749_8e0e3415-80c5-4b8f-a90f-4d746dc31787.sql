-- Les écrans et moteurs attendent exactement un forfait par fournisseur. Un
-- doublon rendait `.maybeSingle()` ambigu et pouvait réactiver un plafond par
-- défaut. On conserve la configuration modifiée le plus récemment.
WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY updated_at DESC, created_at DESC, id DESC) AS position
  FROM public.apify_plan_settings
)
DELETE FROM public.apify_plan_settings plan
USING ranked
WHERE plan.id = ranked.id AND ranked.position > 1;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY updated_at DESC, created_at DESC, id DESC) AS position
  FROM public.newsapi_plan_settings
)
DELETE FROM public.newsapi_plan_settings plan
USING ranked
WHERE plan.id = ranked.id AND ranked.position > 1;

-- La migration historique a semé Developer/100 sans aucune preuve du forfait
-- réellement souscrit. On neutralise uniquement cette ligne encore intacte ;
-- une configuration enregistrée volontairement a un updated_at distinct.
UPDATE public.newsapi_plan_settings
SET plan_name = 'Non configuré', daily_requests = 0
WHERE plan_name = 'Developer'
  AND daily_requests = 100
  AND updated_at = created_at;

CREATE UNIQUE INDEX IF NOT EXISTS apify_plan_settings_singleton
  ON public.apify_plan_settings ((true));
CREATE UNIQUE INDEX IF NOT EXISTS newsapi_plan_settings_singleton
  ON public.newsapi_plan_settings ((true));

DO $$ BEGIN
  ALTER TABLE public.apify_plan_settings
    ADD CONSTRAINT apify_plan_nonnegative CHECK (
      monthly_credits >= 0
      AND alert_threshold_percent BETWEEN 1 AND 100
      AND cost_per_scrape >= 0
      AND current_period_end >= current_period_start
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.newsapi_plan_settings
    ADD CONSTRAINT newsapi_plan_nonnegative CHECK (
      daily_requests >= 0
      AND alert_threshold_percent BETWEEN 1 AND 100
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON INDEX public.apify_plan_settings_singleton IS
  'Un seul forfait Apify autoritaire; absence ou plafond nul bloque les appels.';
COMMENT ON INDEX public.newsapi_plan_settings_singleton IS
  'Un seul forfait NewsAPI autoritaire; absence ou plafond nul bloque les appels.';
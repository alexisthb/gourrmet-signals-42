-- Métriques honnêtes d'acquisition, de qualité Presse et de délivrabilité.
-- Une valeur de coût reste NULL tant qu'aucune facture, API fournisseur ou
-- grille tarifaire datée ne permet de la calculer sans estimation implicite.

ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS detection_run_id uuid
    REFERENCES public.scan_logs(id) ON DELETE SET NULL;

ALTER TABLE public.pappers_signals
  ADD COLUMN IF NOT EXISTS scan_id uuid
    REFERENCES public.pappers_scan_progress(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS signals_detection_run_idx
  ON public.signals(detection_run_id) WHERE detection_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS pappers_signals_scan_idx
  ON public.pappers_signals(scan_id) WHERE scan_id IS NOT NULL;

WITH ranked_press_runs AS (
  SELECT id, row_number() OVER (ORDER BY started_at DESC NULLS LAST, created_at DESC, id DESC) AS position
  FROM public.scan_logs
  WHERE status = 'running'
)
UPDATE public.scan_logs AS log
SET status = 'failed',
    completed_at = now(),
    error_message = 'Run concurrent clôturé par la migration de fiabilisation'
FROM ranked_press_runs AS ranked
WHERE log.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS press_single_active_run
  ON public.scan_logs ((true)) WHERE status = 'running';

-- Transfert Pappers transactionnel : une seule ligne `signals`, puis liaison
-- de l'origine dans la même transaction. Le verrou rend l'appel idempotent.
CREATE OR REPLACE FUNCTION public.transfer_pappers_signal(p_pappers_signal_id uuid)
RETURNS public.signals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  origin public.pappers_signals%ROWTYPE;
  transferred public.signals%ROWTYPE;
  raw_effectif text;
  lower_effectif integer;
  estimated_size text := 'Inconnu';
  mapped_type text;
  mapped_revenue bigint;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO origin
  FROM public.pappers_signals
  WHERE id = p_pappers_signal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal Pappers introuvable' USING ERRCODE = 'P0002';
  END IF;

  IF origin.signal_id IS NOT NULL THEN
    SELECT * INTO transferred FROM public.signals WHERE id = origin.signal_id;
    IF FOUND THEN RETURN transferred; END IF;
  END IF;

  mapped_type := CASE origin.signal_type
    WHEN 'anniversary' THEN 'anniversaire'
    WHEN 'nomination' THEN 'nomination'
    WHEN 'capital_increase' THEN 'levee'
    WHEN 'transfer' THEN 'expansion'
    WHEN 'creation' THEN 'creation'
    ELSE NULL
  END;
  IF mapped_type IS NULL THEN
    RAISE EXCEPTION 'Type de signal Pappers inconnu: %', origin.signal_type
      USING ERRCODE = '22023';
  END IF;

  raw_effectif := COALESCE(origin.company_data->>'effectif', '');
  BEGIN
    lower_effectif := (regexp_match(raw_effectif, '[0-9]+'))[1]::integer;
  EXCEPTION WHEN OTHERS THEN
    lower_effectif := NULL;
  END;
  estimated_size := CASE
    WHEN lower_effectif >= 5000 THEN 'Grand Compte'
    WHEN lower_effectif >= 250 THEN 'ETI'
    WHEN lower_effectif > 0 THEN 'PME'
    ELSE 'Inconnu'
  END;
  mapped_revenue := COALESCE(
    origin.revenue,
    CASE WHEN (origin.company_data->>'chiffre_affaires') ~ '^[0-9]+$'
      THEN (origin.company_data->>'chiffre_affaires')::bigint ELSE NULL END
  );

  INSERT INTO public.signals (
    company_name, signal_type, event_detail, score, source_name, status,
    sector, estimated_size, revenue, revenue_source, detected_at
  ) VALUES (
    origin.company_name,
    mapped_type,
    origin.signal_detail,
    greatest(1, least(5, round(COALESCE(origin.relevance_score, 0)::numeric / 20)::integer)),
    'Pappers',
    'new',
    origin.company_data->>'libelle_code_naf',
    estimated_size,
    mapped_revenue,
    COALESCE(origin.revenue_source, CASE WHEN mapped_revenue IS NOT NULL THEN 'pappers' END),
    origin.detected_at
  )
  RETURNING * INTO transferred;

  UPDATE public.pappers_signals
  SET transferred_to_signals = true,
      processed = true,
      signal_id = transferred.id
  WHERE id = origin.id;

  RETURN transferred;
END;
$$;

-- Handoff auto Pappers -> enrichissement : le transfert et l'enqueue atomique
-- vivent dans la même transaction. Si l'enqueue échoue, la liaison créée est
-- conservée mais `processed` reste faux ; le prochain passage réutilise donc le
-- même signal au lieu d'en créer un second.
CREATE OR REPLACE FUNCTION public.transfer_and_enqueue_pappers_signal(
  p_pappers_signal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  transferred public.signals%ROWTYPE;
  enqueue_result jsonb;
  enqueue_state text;
  enqueue_error text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO STRICT transferred
  FROM public.transfer_pappers_signal(p_pappers_signal_id);

  -- `transfer_pappers_signal` est idempotent et verrouille l'origine. Repasser
  -- temporairement à non traité rend l'échec de queue réparable sans perdre la
  -- liaison `signal_id` déjà créée.
  UPDATE public.pappers_signals
  SET transferred_to_signals = true,
      processed = false,
      signal_id = transferred.id
  WHERE id = p_pappers_signal_id;

  BEGIN
    enqueue_result := public.enqueue_enrichment_job(
      p_signal_id => transferred.id,
      p_job_type => 'contacts',
      p_priority => 5,
      p_cooldown_seconds => 86400
    );
    enqueue_state := enqueue_result->>'state';

    IF enqueue_state IN ('enqueued', 'active') THEN
      UPDATE public.pappers_signals
      SET processed = true
      WHERE id = p_pappers_signal_id
        AND signal_id = transferred.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS enqueue_error = MESSAGE_TEXT;
    enqueue_state := 'error';
    enqueue_result := jsonb_build_object('state', enqueue_state, 'error', enqueue_error);
  END;

  RETURN jsonb_build_object(
    'signal_id', transferred.id,
    'enqueue_state', coalesce(enqueue_state, 'unknown'),
    'processed', coalesce(enqueue_state IN ('enqueued', 'active'), false),
    'enqueue', coalesce(enqueue_result, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_pappers_signal_processed(p_pappers_signal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pappers_signals SET processed = true WHERE id = p_pappers_signal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signal Pappers introuvable' USING ERRCODE = 'P0002'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_pappers_scan(p_scan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_internal_user(auth.uid()) THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.pappers_scan_progress
  WHERE id = p_scan_id AND status IN ('completed', 'error', 'cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seul un scan terminal peut être supprimé' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_pappers_signal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transfer_and_enqueue_pappers_signal(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_pappers_signal_processed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_pappers_scan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_pappers_signal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transfer_and_enqueue_pappers_signal(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_pappers_signal_processed(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_pappers_scan(uuid) TO authenticated, service_role;

-- Réservation stricte NewsAPI : le plafond journalier est vérifié et consommé
-- sous verrou avant l'appel HTTP, y compris lorsque plusieurs scans démarrent
-- simultanément. Une réservation orpheline préfère sous-consommer à dépasser.
CREATE OR REPLACE FUNCTION public.reserve_newsapi_request(
  p_request_key text,
  p_run_id uuid,
  p_query_id uuid,
  p_daily_limit integer,
  p_occurred_at timestamptz,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  used_units numeric := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Service role requis' USING ERRCODE = '42501';
  END IF;
  IF coalesce(trim(p_request_key), '') = '' OR p_daily_limit < 0 THEN
    RAISE EXCEPTION 'Paramètres de réservation NewsAPI invalides' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('gourrmet:newsapi:daily-quota', 0));

  IF EXISTS (
    SELECT 1 FROM public.provider_usage_events
    WHERE provider = 'newsapi' AND request_key = p_request_key
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_request_key');
  END IF;

  SELECT coalesce(sum(units), 0) INTO used_units
  FROM public.provider_usage_events
  WHERE provider = 'newsapi'
    AND occurred_at >= date_trunc('day', COALESCE(p_occurred_at, now()))
    AND occurred_at < date_trunc('day', COALESCE(p_occurred_at, now())) + interval '1 day';

  IF used_units + 1 > p_daily_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'daily_quota_exhausted',
      'used', used_units,
      'limit', p_daily_limit
    );
  END IF;

  INSERT INTO public.provider_usage_events (
    provider, operation, run_id, query_id, request_key, units,
    requests_count, items_count, success, error_code, occurred_at, metadata
  ) VALUES (
    'newsapi', 'everything', p_run_id, p_query_id, p_request_key, 1,
    1, 0, false, 'reserved', COALESCE(p_occurred_at, now()), COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object(
    'allowed', true,
    'used_before', used_units,
    'used_after', used_units + 1,
    'limit', p_daily_limit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_newsapi_request(
  text, uuid, uuid, integer, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_newsapi_request(
  text, uuid, uuid, integer, timestamptz, jsonb
) TO service_role;

CREATE TABLE IF NOT EXISTS public.provider_cost_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN (
    'newsapi', 'pappers', 'apify', 'dropcontact', 'perplexity',
    'lovable_ai', 'lovable_email', 'resend'
  )),
  operation text NOT NULL,
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  source text NOT NULL CHECK (source IN ('invoice', 'provider_api', 'configured_rate')),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS provider_cost_rates_lookup_idx
  ON public.provider_cost_rates(provider, operation, effective_from DESC);

ALTER TABLE public.provider_cost_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS provider_cost_rates_service_all ON public.provider_cost_rates;
CREATE POLICY provider_cost_rates_service_all ON public.provider_cost_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS provider_cost_rates_admin_read ON public.provider_cost_rates;
CREATE POLICY provider_cost_rates_admin_read ON public.provider_cost_rates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.provider_cost_rates FROM anon;
GRANT SELECT ON public.provider_cost_rates TO authenticated;
GRANT ALL ON public.provider_cost_rates TO service_role;

-- Idem : la forme des colonnes change d'une révision à l'autre, donc la vue est
-- déposée avant d'être recréée. CASCADE emporte les vues dérivées, qui sont
-- recréées par les migrations suivantes dans l'ordre lexical.
DROP VIEW IF EXISTS public.provider_usage_costed CASCADE;
CREATE OR REPLACE VIEW public.provider_usage_costed
WITH (security_invoker = true)
AS
-- Colonnes énumérées, et non `usage.*` : une migration versionnée ne doit pas
-- dépendre de la forme FUTURE de la table. `20260820173000` promeut plus tard
-- effective_cost_amount / effective_currency / effective_cost_source en
-- colonnes réelles ; avec `usage.*`, la vue rejouée les sélectionnait deux fois
-- (« column specified more than once ») et la migration cessait d'être
-- rejouable. La liste ci-dessous est celle de la table à cette révision.
SELECT
  usage.id,
  usage.provider,
  usage.operation,
  usage.run_id,
  usage.query_id,
  usage.signal_id,
  usage.contact_id,
  usage.request_key,
  usage.units,
  usage.requests_count,
  usage.items_count,
  usage.cost_amount,
  usage.currency,
  usage.cost_source,
  usage.success,
  usage.error_code,
  usage.metadata,
  usage.occurred_at,
  usage.created_at,
  COALESCE(usage.cost_amount, usage.units * rate.unit_price) AS effective_cost_amount,
  COALESCE(usage.currency, rate.currency) AS effective_currency,
  COALESCE(usage.cost_source, rate.source) AS effective_cost_source,
  (COALESCE(usage.cost_amount, usage.units * rate.unit_price) IS NOT NULL) AS is_priced
FROM public.provider_usage_events AS usage
LEFT JOIN LATERAL (
  SELECT configured.unit_price, configured.currency, configured.source
  FROM public.provider_cost_rates AS configured
  WHERE configured.provider = usage.provider
    AND configured.operation = usage.operation
    AND configured.effective_from <= usage.occurred_at
    AND (configured.effective_to IS NULL OR configured.effective_to > usage.occurred_at)
  ORDER BY configured.effective_from DESC, configured.created_at DESC
  LIMIT 1
) AS rate ON true;

COMMENT ON VIEW public.provider_usage_costed IS
  'Ledger enrichi par un tarif daté. effective_cost_amount est NULL lorsqu aucun prix fiable ne couvre l appel.';
REVOKE ALL ON public.provider_usage_costed FROM anon, authenticated;
GRANT SELECT ON public.provider_usage_costed TO service_role;

CREATE OR REPLACE VIEW public.provider_usage_daily_metrics
WITH (security_invoker = true)
AS
SELECT
  occurred_at::date AS usage_date,
  provider,
  operation,
  count(*) AS event_count,
  count(*) FILTER (WHERE success) AS successful_event_count,
  sum(requests_count) AS request_count,
  sum(units) AS units,
  sum(items_count) AS items,
  count(*) FILTER (WHERE NOT is_priced) AS unpriced_event_count,
  CASE WHEN bool_and(is_priced) THEN sum(effective_cost_amount) ELSE NULL END AS total_cost,
  CASE WHEN count(DISTINCT effective_currency) = 1 THEN min(effective_currency) ELSE NULL END AS currency,
  bool_and(is_priced) AS fully_priced
FROM public.provider_usage_costed
GROUP BY occurred_at::date, provider, operation;

COMMENT ON VIEW public.provider_usage_daily_metrics IS
  'Consommation réelle par jour. total_cost reste NULL si au moins un appel du groupe n est pas tarifé.';
REVOKE ALL ON public.provider_usage_daily_metrics FROM anon, authenticated;
GRANT SELECT ON public.provider_usage_daily_metrics TO service_role;

CREATE OR REPLACE VIEW public.acquisition_run_cost_metrics
WITH (security_invoker = true)
AS
WITH runs AS (
  SELECT
    'press'::text AS source,
    log.id AS run_id,
    log.status,
    log.started_at,
    log.completed_at,
    count(signal.id)::bigint AS signals_created
  FROM public.scan_logs AS log
  LEFT JOIN public.signals AS signal ON signal.detection_run_id = log.id
  GROUP BY log.id, log.status, log.started_at, log.completed_at
  UNION ALL
  SELECT
    'pappers'::text AS source,
    progress.id AS run_id,
    progress.status,
    COALESCE(progress.started_at, progress.created_at) AS started_at,
    progress.completed_at,
    count(signal.id)::bigint AS signals_created
  FROM public.pappers_scan_progress AS progress
  LEFT JOIN public.pappers_signals AS signal ON signal.scan_id = progress.id
  GROUP BY progress.id, progress.status, progress.started_at, progress.created_at, progress.completed_at
), usage AS (
  SELECT
    run_id,
    count(*) AS provider_event_count,
    sum(requests_count) AS provider_request_count,
    sum(units) AS provider_units,
    count(*) FILTER (WHERE NOT is_priced) AS unpriced_event_count,
    bool_and(is_priced) AS fully_priced,
    CASE WHEN bool_and(is_priced) THEN sum(effective_cost_amount) ELSE NULL END AS total_cost,
    CASE WHEN count(DISTINCT effective_currency) = 1 THEN min(effective_currency) ELSE NULL END AS currency
  FROM public.provider_usage_costed
  WHERE run_id IS NOT NULL
  GROUP BY run_id
)
SELECT
  runs.source,
  runs.run_id,
  runs.status,
  runs.started_at,
  runs.completed_at,
  runs.signals_created,
  COALESCE(usage.provider_event_count, 0) AS provider_event_count,
  COALESCE(usage.provider_request_count, 0) AS provider_request_count,
  COALESCE(usage.provider_units, 0) AS provider_units,
  COALESCE(usage.unpriced_event_count, 0) AS unpriced_event_count,
  COALESCE(usage.fully_priced, false) AS fully_priced,
  usage.total_cost,
  usage.currency,
  CASE
    WHEN usage.fully_priced AND runs.signals_created > 0
      THEN round(usage.total_cost / runs.signals_created, 6)
    ELSE NULL
  END AS cost_per_created_signal
FROM runs
LEFT JOIN usage ON usage.run_id = runs.run_id;

COMMENT ON VIEW public.acquisition_run_cost_metrics IS
  'Coût moyen par nouveau signal dans un run. NULL si le run est non tarifé ou ne crée aucun signal.';
REVOKE ALL ON public.acquisition_run_cost_metrics FROM anon, authenticated;
GRANT SELECT ON public.acquisition_run_cost_metrics TO service_role;

CREATE TABLE IF NOT EXISTS public.press_signal_quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'uncertain')),
  evidence jsonb NOT NULL DEFAULT '{}',
  reviewed_by uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_id)
);

CREATE TABLE IF NOT EXISTS public.press_expected_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_article_id uuid NOT NULL REFERENCES public.raw_articles(id) ON DELETE CASCADE,
  expected_company_name text NOT NULL,
  expected_signal_type text NOT NULL CHECK (expected_signal_type IN (
    'anniversaire', 'levee', 'ma', 'distinction', 'expansion', 'nomination'
  )),
  matched_signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  reviewed_by uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS press_expected_opportunity_unique
  ON public.press_expected_opportunities(
    raw_article_id,
    lower(regexp_replace(expected_company_name, '[^[:alnum:]]+', '', 'g')),
    expected_signal_type
  );

CREATE OR REPLACE FUNCTION public.validate_press_expected_opportunity_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE linked_signal public.signals%ROWTYPE;
BEGIN
  IF NEW.matched_signal_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO linked_signal FROM public.signals WHERE id = NEW.matched_signal_id;
  IF NOT FOUND
     OR linked_signal.article_id IS DISTINCT FROM NEW.raw_article_id
     OR linked_signal.signal_type IS DISTINCT FROM NEW.expected_signal_type THEN
    RAISE EXCEPTION 'Le signal associé doit venir du même article et avoir le type attendu';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS press_expected_opportunity_match_check
  ON public.press_expected_opportunities;
CREATE TRIGGER press_expected_opportunity_match_check
  BEFORE INSERT OR UPDATE ON public.press_expected_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.validate_press_expected_opportunity_match();

ALTER TABLE public.press_signal_quality_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.press_expected_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS press_signal_quality_reviews_service_all ON public.press_signal_quality_reviews;
CREATE POLICY press_signal_quality_reviews_service_all ON public.press_signal_quality_reviews
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS press_expected_opportunities_service_all ON public.press_expected_opportunities;
CREATE POLICY press_expected_opportunities_service_all ON public.press_expected_opportunities
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.press_signal_quality_reviews FROM anon, authenticated;
REVOKE ALL ON public.press_expected_opportunities FROM anon, authenticated;
GRANT ALL ON public.press_signal_quality_reviews TO service_role;
GRANT ALL ON public.press_expected_opportunities TO service_role;

DROP VIEW IF EXISTS public.press_detection_quality_metrics CASCADE;
CREATE OR REPLACE VIEW public.press_detection_quality_metrics
WITH (security_invoker = true)
AS
WITH precision_labels AS (
  SELECT
    count(*) FILTER (WHERE verdict IN ('correct', 'incorrect')) AS labelled_predictions,
    count(*) FILTER (WHERE verdict = 'correct') AS correct_predictions,
    count(*) FILTER (WHERE verdict = 'incorrect') AS incorrect_predictions,
    count(*) FILTER (WHERE verdict = 'uncertain') AS uncertain_predictions
  FROM public.press_signal_quality_reviews
), recall_labels AS (
  SELECT
    count(*) AS expected_opportunities,
    count(*) FILTER (WHERE matched_signal_id IS NOT NULL) AS matched_opportunities
  FROM public.press_expected_opportunities
)
SELECT
  now() AS measured_at,
  precision_labels.labelled_predictions,
  precision_labels.correct_predictions,
  precision_labels.incorrect_predictions,
  precision_labels.uncertain_predictions,
  round(
    precision_labels.correct_predictions::numeric
    / nullif(precision_labels.labelled_predictions, 0),
    4
  ) AS labelled_precision,
  recall_labels.expected_opportunities,
  recall_labels.matched_opportunities,
  round(
    recall_labels.matched_opportunities::numeric
    / nullif(recall_labels.expected_opportunities, 0),
    4
  ) AS labelled_recall
FROM precision_labels CROSS JOIN recall_labels;

COMMENT ON VIEW public.press_detection_quality_metrics IS
  'Précision et rappel uniquement sur le corpus revu. Les taux restent NULL sans labels.';
REVOKE ALL ON public.press_detection_quality_metrics FROM anon, authenticated;
GRANT SELECT ON public.press_detection_quality_metrics TO service_role;

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
    count(*) FILTER (WHERE status = 'replied') AS provider_tracked_replies,
    count(*) FILTER (WHERE status = 'failed') AS failed,
    count(*) FILTER (WHERE status = 'suppressed') AS suppressed
  FROM public.emails_sent
), delivered_contacts AS (
  SELECT DISTINCT email_row.contact_id
  FROM public.emails_sent AS email_row
  WHERE email_row.delivered_at IS NOT NULL AND email_row.contact_id IS NOT NULL
), crm AS (
  SELECT
    count(*) AS delivered_contacts,
    count(*) FILTER (WHERE contact.outreach_status IN ('responded', 'meeting', 'converted')) AS response_proxy_contacts,
    count(*) FILTER (WHERE contact.outreach_status = 'converted') AS converted_proxy_contacts
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
  round(email.delivered::numeric / nullif(email.provider_accepted, 0), 4) AS delivery_rate,
  round(email.bounced::numeric / nullif(email.provider_accepted, 0), 4) AS bounce_rate,
  round(email.complained::numeric / nullif(email.provider_accepted, 0), 4) AS complaint_rate,
  round(email.provider_tracked_replies::numeric / nullif(email.delivered, 0), 4) AS tracked_reply_rate,
  crm.delivered_contacts,
  crm.response_proxy_contacts,
  crm.converted_proxy_contacts,
  round(crm.response_proxy_contacts::numeric / nullif(crm.delivered_contacts, 0), 4) AS crm_response_proxy_rate,
  round(crm.converted_proxy_contacts::numeric / nullif(crm.delivered_contacts, 0), 4) AS crm_conversion_proxy_rate
FROM email CROSS JOIN crm;

COMMENT ON VIEW public.email_delivery_metrics IS
  'Délivrabilité fournisseur et proxys CRM. Les proxys réponse/conversion ne prouvent pas la causalité email.';
REVOKE ALL ON public.email_delivery_metrics FROM anon, authenticated;
GRANT SELECT ON public.email_delivery_metrics TO service_role;

-- Le contact et son historique commercial ne passent à « envoyé » qu'au
-- premier statut accepté par le fournisseur, jamais lors de l'enqueue.
CREATE OR REPLACE FUNCTION public.auto_transition_contact_on_email_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.contact_id IS NULL
     OR NEW.status NOT IN ('sent', 'delivered', 'bounced', 'complained', 'replied')
     OR OLD.status IN ('sent', 'delivered', 'bounced', 'complained', 'replied') THEN
    RETURN NEW;
  END IF;

  UPDATE public.contacts
  SET outreach_status = 'email_sent', updated_at = now()
  WHERE id = NEW.contact_id
    AND outreach_status IN ('new', 'linkedin_sent');

  INSERT INTO public.contact_interactions (
    contact_id, action_type, new_value, metadata
  ) VALUES (
    NEW.contact_id,
    'email_sent',
    NEW.subject,
    jsonb_build_object(
      'email_id', NEW.id,
      'provider', NEW.provider,
      'provider_message_id', NEW.provider_message_id,
      'accepted_at', NEW.sent_at
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emails_sent_contact_sync ON public.emails_sent;
CREATE TRIGGER emails_sent_contact_sync
  AFTER UPDATE ON public.emails_sent
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_transition_contact_on_email_acceptance();

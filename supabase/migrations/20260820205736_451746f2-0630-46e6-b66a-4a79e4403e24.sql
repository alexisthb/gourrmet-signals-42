-- Claim atomique des articles Presse. Deux analyseurs concurrents ne peuvent
-- plus consommer le même lot, et toute panne reste explicitement reprenable.

ALTER TABLE public.raw_articles
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_articles_press_claim
  ON public.raw_articles (processed, next_retry_at, claimed_at, attempt_count, published_at DESC)
  WHERE processed IS NOT TRUE AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_raw_articles_claim_token
  ON public.raw_articles (claim_token)
  WHERE claim_token IS NOT NULL;

DROP FUNCTION IF EXISTS public.claim_press_articles(INTEGER, INTERVAL);
CREATE OR REPLACE FUNCTION public.claim_press_articles(
  p_limit INTEGER DEFAULT 30,
  p_stale_after INTERVAL DEFAULT INTERVAL '15 minutes',
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS SETOF public.raw_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_stale_after constant interval := interval '15 minutes';
  v_max_attempts constant integer := 5;
BEGIN
  -- La vue d'exploitation ci-dessous est volontairement fondée sur la même
  -- politique canonique. Refuser une valeur divergente évite des métriques
  -- apparemment exactes qui classeraient mal le backlog.
  IF COALESCE(p_max_attempts, v_max_attempts) <> v_max_attempts THEN
    RAISE EXCEPTION 'Le maximum opérationnel Presse est fixé à % tentatives', v_max_attempts
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_stale_after, v_stale_after) <> v_stale_after THEN
    RAISE EXCEPTION 'Le délai stale opérationnel Presse est fixé à 15 minutes'
      USING ERRCODE = '22023';
  END IF;

  -- Une Edge Function peut mourir après avoir pris sa dernière tentative. Le
  -- claim devient alors stale mais restait jusque-là hors sélection et hors
  -- DLQ à vie. Le sweep et le claim suivant vivent dans la même transaction.
  UPDATE public.raw_articles AS article
  SET claim_token = NULL,
      claimed_at = NULL,
      next_retry_at = NULL,
      last_error = COALESCE(NULLIF(article.last_error, ''), 'press_claim_expired_after_max_attempts'),
      dead_lettered_at = now(),
      dead_letter_reason = 'press_claim_expired_after_max_attempts'
  WHERE article.processed IS NOT TRUE
    AND article.dead_lettered_at IS NULL
    AND article.attempt_count >= v_max_attempts
    AND (
      article.claim_token IS NULL
      OR article.claimed_at IS NULL
      OR article.claimed_at < now() - v_stale_after
    );

  RETURN QUERY
  WITH batch_token AS MATERIALIZED (
    SELECT gen_random_uuid() AS token
  ), candidates AS MATERIALIZED (
    SELECT article.id
    FROM public.raw_articles AS article
    WHERE article.processed IS NOT TRUE
      AND article.dead_lettered_at IS NULL
      AND article.attempt_count < v_max_attempts
      AND (article.next_retry_at IS NULL OR article.next_retry_at <= now())
      AND (
        article.claim_token IS NULL
        OR article.claimed_at IS NULL
        OR article.claimed_at < now() - v_stale_after
      )
    ORDER BY article.attempt_count ASC,
             article.published_at DESC NULLS LAST,
             article.created_at DESC NULLS LAST,
             article.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.raw_articles AS article
    SET claim_token = batch_token.token,
        claimed_at = now(),
        attempt_count = article.attempt_count + 1
    FROM candidates, batch_token
    WHERE article.id = candidates.id
    RETURNING article.*
  )
  SELECT *
  FROM claimed
  ORDER BY published_at DESC NULLS LAST, created_at DESC NULLS LAST, id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_press_articles(
  p_claim_token UUID,
  p_article_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  IF p_claim_token IS NULL OR COALESCE(cardinality(p_article_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.raw_articles
  SET processed = TRUE,
      claim_token = NULL,
      claimed_at = NULL,
      last_error = NULL,
      next_retry_at = NULL,
      dead_lettered_at = NULL,
      dead_letter_reason = NULL
  WHERE claim_token = p_claim_token
    AND id = ANY(p_article_ids);

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

DROP FUNCTION IF EXISTS public.fail_press_articles(UUID, TEXT, UUID[]);
CREATE OR REPLACE FUNCTION public.fail_press_articles(
  p_claim_token UUID,
  p_error TEXT,
  p_article_ids UUID[] DEFAULT NULL,
  p_max_attempts INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  IF p_claim_token IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE(p_max_attempts, 5) <> 5 THEN
    RAISE EXCEPTION 'Le maximum opérationnel Presse est fixé à 5 tentatives'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.raw_articles
  SET claim_token = NULL,
      claimed_at = NULL,
      last_error = LEFT(COALESCE(NULLIF(p_error, ''), 'unknown_press_error'), 2000),
      next_retry_at = CASE
        WHEN attempt_count >= 5 THEN NULL
        ELSE now() + make_interval(secs => LEAST(
          21600,
          (60 * power(2::numeric, GREATEST(attempt_count - 1, 0)))::integer
        ))
      END,
      dead_lettered_at = CASE
        WHEN attempt_count >= 5 THEN now()
        ELSE NULL
      END,
      dead_letter_reason = CASE
        WHEN attempt_count >= 5
          THEN LEFT(COALESCE(NULLIF(p_error, ''), 'unknown_press_error'), 2000)
        ELSE NULL
      END
  WHERE claim_token = p_claim_token
    AND (p_article_ids IS NULL OR id = ANY(p_article_ids));

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_press_articles(p_claim_token UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  IF p_claim_token IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.raw_articles
  SET claim_token = NULL,
      claimed_at = NULL,
      next_retry_at = GREATEST(COALESCE(next_retry_at, now()), now() + interval '1 minute')
  WHERE claim_token = p_claim_token;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows;
END;
$$;

DROP VIEW IF EXISTS public.press_article_backlog_metrics;
CREATE VIEW public.press_article_backlog_metrics
WITH (security_invoker = true)
AS
WITH policy AS (
  SELECT now() AS measured_at, 5::integer AS max_attempts, interval '15 minutes' AS stale_after
), classified AS (
  SELECT article.*,
         policy.measured_at,
         policy.max_attempts,
         policy.stale_after,
         (
           article.dead_lettered_at IS NULL
           AND article.claim_token IS NOT NULL
           AND article.claimed_at IS NOT NULL
           AND article.claimed_at >= policy.measured_at - policy.stale_after
         ) AS claim_active
  FROM public.raw_articles article
  CROSS JOIN policy
)
SELECT
  now() AS measured_at,
  5::integer AS operational_max_attempts,
  interval '15 minutes' AS operational_stale_after,
  count(*) FILTER (
    WHERE processed IS NOT TRUE
      AND dead_lettered_at IS NULL
      AND attempt_count < max_attempts
      AND NOT claim_active
      AND (next_retry_at IS NULL OR next_retry_at <= now())
  ) AS ready,
  count(*) FILTER (
    WHERE processed IS NOT TRUE
      AND dead_lettered_at IS NULL
      AND claim_active
  ) AS in_flight,
  count(*) FILTER (
    WHERE processed IS NOT TRUE
      AND dead_lettered_at IS NULL
      AND attempt_count < max_attempts
      AND NOT claim_active
      AND next_retry_at > now()
  ) AS retry_waiting,
  count(*) FILTER (
    WHERE dead_lettered_at IS NOT NULL
  ) AS dead_lettered,
  count(*) FILTER (
    WHERE processed IS NOT TRUE
      AND dead_lettered_at IS NULL
      AND attempt_count >= max_attempts
      AND NOT claim_active
  ) AS exhausted_orphan,
  max(attempt_count) FILTER (WHERE processed IS NOT TRUE) AS max_attempt_count,
  min(next_retry_at) FILTER (
    WHERE processed IS NOT TRUE
      AND dead_lettered_at IS NULL
      AND attempt_count < max_attempts
      AND NOT claim_active
      AND next_retry_at > now()
  ) AS next_retry_at
FROM classified;

REVOKE ALL ON FUNCTION public.claim_press_articles(INTEGER, INTERVAL, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_press_articles(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_press_articles(UUID, TEXT, UUID[], INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_press_articles(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_press_articles(INTEGER, INTERVAL, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_press_articles(UUID, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_press_articles(UUID, TEXT, UUID[], INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_press_articles(UUID) TO service_role;
REVOKE ALL ON public.press_article_backlog_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.press_article_backlog_metrics TO service_role;
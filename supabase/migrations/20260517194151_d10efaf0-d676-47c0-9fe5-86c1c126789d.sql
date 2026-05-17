CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent', $1);
$$;

ALTER TABLE signals ADD COLUMN IF NOT EXISTS company_name_normalized TEXT
  GENERATED ALWAYS AS (lower(public.immutable_unaccent(company_name))) STORED;

CREATE INDEX IF NOT EXISTS idx_signals_company_trgm
  ON signals USING gin (company_name_normalized gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_signals_company_normalized
  ON signals (company_name_normalized);

CREATE OR REPLACE FUNCTION find_company_dupes(
  p_company_name TEXT,
  p_similarity_threshold REAL DEFAULT 0.8
)
RETURNS TABLE (
  signal_id UUID,
  company_name TEXT,
  similarity REAL,
  detected_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.id,
    s.company_name,
    similarity(s.company_name_normalized, lower(public.immutable_unaccent(p_company_name))) AS sim,
    s.detected_at
  FROM signals s
  WHERE s.company_name_normalized % lower(public.immutable_unaccent(p_company_name))
    AND similarity(s.company_name_normalized, lower(public.immutable_unaccent(p_company_name))) >= p_similarity_threshold
  ORDER BY sim DESC, s.detected_at DESC
  LIMIT 20;
$$;

CREATE OR REPLACE VIEW signals_grouped_by_company AS
SELECT
  company_name_normalized AS company_key,
  (array_agg(company_name ORDER BY detected_at DESC))[1] AS company_name,
  COUNT(*)::INT AS signals_count,
  array_agg(id ORDER BY detected_at DESC) AS signal_ids,
  array_agg(signal_type ORDER BY detected_at DESC) AS signal_types,
  MAX(detected_at) AS last_signal_at,
  MAX(score) AS max_score,
  bool_or(pipeline_status IN ('sent', 'replied')) AS already_contacted,
  bool_or(status = 'contacted') AS commercially_contacted
FROM signals
WHERE COALESCE(is_seed, FALSE) = FALSE
GROUP BY company_name_normalized;

GRANT SELECT ON signals_grouped_by_company TO authenticated, service_role;
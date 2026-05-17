-- GR-003 : Dedoublonnage des signaux par entreprise.
-- Approche "douce" (validee user) : on ne fusionne pas en DB, on groupe a l'affichage.
--
-- Note importante (corrige le bug "generation expression is not immutable") :
--   unaccent(text) est STABLE par defaut (depend du search_path pour resoudre
--   le dictionnaire), donc inutilisable dans une colonne GENERATED STORED.
--   On wrappe via immutable_unaccent qui passe le dictionnaire en explicite
--   ('public.unaccent'), ce qui rend la fonction deterministe.
--   Pattern officiel Supabase : https://supabase.com/docs/guides/database/extensions/unaccent

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

-- Fonction : pour un nom donne, retourne les signal_ids similaires (similarite > seuil).
-- Utilisable depuis l'app pour proposer "Cette entreprise existe deja, voulez-vous fusionner ?".
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

-- Vue agregat : 1 ligne par nom d'entreprise normalise + array des signaux.
-- Note : on garde les variations de casse (Coca-Cola vs COCA-COLA) regroupees,
-- mais pas encore les fuzzy proches (Coca Cola vs Coca-Cola) -- pour ca utiliser find_company_dupes.
CREATE OR REPLACE VIEW signals_grouped_by_company AS
SELECT
  company_name_normalized AS company_key,
  -- on prend le nom du signal le plus recent pour l'affichage
  (array_agg(company_name ORDER BY detected_at DESC))[1] AS company_name,
  COUNT(*)::INT AS signals_count,
  array_agg(id ORDER BY detected_at DESC) AS signal_ids,
  array_agg(signal_type ORDER BY detected_at DESC) AS signal_types,
  MAX(detected_at) AS last_signal_at,
  MAX(score) AS max_score,
  -- Pour le garde-fou "deja contacte" GR-003
  bool_or(pipeline_status IN ('sent', 'replied')) AS already_contacted,
  bool_or(status = 'contacted') AS commercially_contacted
FROM signals
WHERE COALESCE(is_seed, FALSE) = FALSE
GROUP BY company_name_normalized;

GRANT SELECT ON signals_grouped_by_company TO authenticated, service_role;

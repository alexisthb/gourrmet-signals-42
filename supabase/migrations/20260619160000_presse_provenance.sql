-- =========================================================================
-- Provenance Presse — ne garder QUE les signaux réellement issus du scraping
-- NewsAPI, supprimer les faux signaux fabriqués (mock Lovable, ex: « Sonia
-- Dubois ») qui n'ont aucune traçabilité à un article scrappé.
--
-- RAPPEL DE LA CHAÎNE RÉELLE :
--   fetch-news  -> raw_articles (1 ligne par article, `url` unique)
--   analyze-articles -> signals.source_url = URL EXACTE de l'article analysé
--                       signals.source_name = nom du média (raw_articles.source_name)
--
-- DONC, juge de paix de l'authenticité d'un signal Presse :
--   VRAI  = signals.source_url correspond à une ligne réelle de raw_articles
--   FAUX  = source_url NULL, ou source_url qui ne pointe vers AUCUN article scrappé
--           => entrée fabriquée insérée directement (mock), SANS drapeau is_seed.
--           C'est pour ça que la purge par drapeaux (is_seed / enrichment_source)
--           laissait passer ces faux : ils ressemblent à de vrais signaux.
--
-- La colonne « Ignorés » de l'UI = signals.status = 'ignored'. La plupart des
-- faux y ont été parqués à la main, MAIS cette colonne peut aussi contenir de
-- VRAIS signaux volontairement écartés -> on NE supprime PAS sur le statut, on
-- supprime sur la traçabilité, et on croise avec 'ignored' juste pour contrôle.
--
-- Périmètre : PRESSE uniquement (= ni Pappers ni LinkedIn). Aligné sur le filtre
-- de 20260619140000_presse_maintenance.sql, mais SANS la clause is_seed (on veut
-- justement inclure d'éventuels seeds comme « faux » à supprimer).
--
-- Les 2 fonctions sont SECURITY DEFINER + service_role only (appelées par la
-- fonction Edge presse-maintenance après contrôle du rôle admin).
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) RAPPORT DE PROVENANCE — read-only, AUCUNE mutation.
--    Classe les signaux Presse en real / fake_no_url / fake_url_unmatched,
--    croise avec 'ignored', chiffre l'impact d'un wipe, et renvoie des
--    ÉCHANTILLONS de noms pour vérification humaine avant tout DELETE.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_provenance_report()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH presse AS (
    SELECT
      s.id, s.company_name, s.signal_type, s.source_name, s.source_url,
      s.status, s.created_at,
      (s.source_url IS NOT NULL AND s.source_url <> ''
        AND EXISTS (SELECT 1 FROM raw_articles ra WHERE ra.url = s.source_url)) AS is_real,
      (s.source_url IS NULL OR s.source_url = '') AS no_url
    FROM signals s
    WHERE s.source_name IS DISTINCT FROM 'Pappers'
      AND s.source_name IS DISTINCT FROM 'LinkedIn'
      AND COALESCE(s.signal_type,'') NOT IN
          ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
  ),
  classified AS (
    SELECT *,
      CASE WHEN is_real THEN 'real'
           WHEN no_url  THEN 'fake_no_url'
           ELSE 'fake_url_unmatched' END AS bucket
    FROM presse
  )
  SELECT jsonb_build_object(
    'presse_total',         (SELECT COUNT(*) FROM classified),
    'real_scraped',         (SELECT COUNT(*) FROM classified WHERE bucket = 'real'),
    'fake_no_url',          (SELECT COUNT(*) FROM classified WHERE bucket = 'fake_no_url'),
    'fake_url_unmatched',   (SELECT COUNT(*) FROM classified WHERE bucket = 'fake_url_unmatched'),
    'fake_total',           (SELECT COUNT(*) FROM classified WHERE bucket <> 'real'),
    -- Croisement avec la colonne « Ignorés »
    'ignored_total',        (SELECT COUNT(*) FROM classified WHERE status = 'ignored'),
    'ignored_and_fake',     (SELECT COUNT(*) FROM classified WHERE status = 'ignored' AND bucket <> 'real'),
    'ignored_but_real',     (SELECT COUNT(*) FROM classified WHERE status = 'ignored' AND bucket = 'real'),
    'fake_not_ignored',     (SELECT COUNT(*) FROM classified WHERE bucket <> 'real' AND status IS DISTINCT FROM 'ignored'),
    -- Impact d'un wipe
    'contacts_on_fakes',    (SELECT COUNT(*) FROM contacts c JOIN classified cl ON cl.id = c.signal_id WHERE cl.bucket <> 'real'),
    'enrichments_on_fakes', (SELECT COUNT(*) FROM company_enrichment ce JOIN classified cl ON cl.id = ce.signal_id WHERE cl.bucket <> 'real'),
    'credit_rows_on_fakes', (SELECT COUNT(*) FROM manus_credit_usage mu JOIN classified cl ON cl.id = mu.signal_id WHERE cl.bucket <> 'real'),
    -- Échantillons pour contrôle humain
    'sample_fakes', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'company_name', company_name, 'status', status, 'signal_type', signal_type,
          'source_name', source_name, 'source_url', source_url, 'bucket', bucket
        )
        FROM classified WHERE bucket <> 'real' ORDER BY created_at DESC LIMIT 30
      ) x
    ),
    -- Les VRAIS signaux parqués en « Ignorés » : on NE les supprime PAS, vérifier
    'sample_ignored_but_real', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('company_name', company_name, 'signal_type', signal_type, 'source_name', source_name)
        FROM classified WHERE status = 'ignored' AND bucket = 'real' ORDER BY created_at DESC LIMIT 20
      ) x
    ),
    -- Quelques vrais signaux, pour confirmer que la détection « real » est saine
    'sample_real', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('company_name', company_name, 'status', status, 'source_name', source_name)
        FROM classified WHERE bucket = 'real' ORDER BY created_at DESC LIMIT 10
      ) x
    )
  );
$$;

-- -------------------------------------------------------------------------
-- 2) WIPE DES FAUX SIGNAUX — supprime les signaux Presse NON tracés à un
--    article scrappé, + cascade (contacts, enrichissements, jobs, interactions).
--    p_dry_run = true par défaut : simule et renvoie seulement les compteurs.
--
--    Sécurité FK : manus_credit_usage et apify_credit_usage référencent
--    signals(id) SANS ON DELETE -> on DÉTACHE (SET NULL) avant le DELETE pour
--    ne pas perdre l'historique de crédits, et pour ne pas être bloqué.
--    La fonction est transactionnelle (plpgsql) : si une FK inconnue bloquait,
--    TOUT est annulé — aucune suppression partielle.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_wipe_unscraped(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_contacts int := 0;
  v_enr int := 0;
  v_jobs int := 0;
  v_deleted int := 0;
  v_credit_unlinked int := 0;
  v_samples jsonb;
BEGIN
  -- Faux signal Presse = PAS traçable à un article réellement scrappé
  SELECT array_agg(s.id) INTO v_ids
  FROM signals s
  WHERE s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND NOT (
      s.source_url IS NOT NULL AND s.source_url <> ''
      AND EXISTS (SELECT 1 FROM raw_articles ra WHERE ra.url = s.source_url)
    );

  v_count := COALESCE(array_length(v_ids,1),0);

  SELECT COUNT(*) INTO v_contacts FROM contacts WHERE signal_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_enr FROM company_enrichment WHERE signal_id = ANY(v_ids);
  SELECT COUNT(*) INTO v_jobs FROM enrichment_jobs WHERE signal_id = ANY(v_ids);

  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_samples FROM (
    SELECT jsonb_build_object(
      'company_name', company_name, 'status', status,
      'source_name', source_name, 'source_url', source_url
    )
    FROM signals WHERE id = ANY(v_ids) ORDER BY created_at DESC LIMIT 30
  ) x;

  IF p_dry_run OR v_count = 0 THEN
    RETURN jsonb_build_object(
      'dry_run', p_dry_run,
      'fake_signals_targeted', v_count,
      'contacts_to_delete', v_contacts,
      'enrichments_to_delete', v_enr,
      'jobs_to_delete', v_jobs,
      'sample', v_samples
    );
  END IF;

  -- Détacher les références sans ON DELETE (sinon blocage FK)
  UPDATE manus_credit_usage SET signal_id = NULL WHERE signal_id = ANY(v_ids);
  GET DIAGNOSTICS v_credit_unlinked = ROW_COUNT;
  UPDATE apify_credit_usage SET signal_id = NULL WHERE signal_id = ANY(v_ids);

  -- Suppression : CASCADE gère contacts / company_enrichment / enrichment_jobs /
  -- signal_interactions ; SET NULL gère emails_sent & co.
  DELETE FROM signals WHERE id = ANY(v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false,
    'fake_signals_deleted', v_deleted,
    'contacts_deleted_cascade', v_contacts,
    'enrichments_deleted_cascade', v_enr,
    'jobs_deleted_cascade', v_jobs,
    'credit_rows_unlinked', v_credit_unlinked,
    'sample', v_samples
  );
END;
$$;

-- -------------------------------------------------------------------------
-- Permissions : service_role uniquement
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.presse_provenance_report()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_wipe_unscraped(boolean)    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.presse_provenance_report()        TO service_role;
GRANT  EXECUTE ON FUNCTION public.presse_wipe_unscraped(boolean)    TO service_role;

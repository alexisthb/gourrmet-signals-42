-- =========================================================================
-- Maintenance Presse — relance enrichissement Manus (contacts), résolution
-- des signaux "problème", et purge des données mock historiques.
--
-- Contexte : la clé API Manus a été changée. Beaucoup de signaux Presse sont
-- restés bloqués en enrichment_status='manus_processing' (cron-check-manus ne
-- repasse JAMAIS un enrichment en 'failed' quand le poll Manus échoue — il le
-- laisse en manus_processing ad infinitum). D'autres sont en 'failed'. Enfin,
-- des contacts mock historiques (enrichment_source IN ('mock','lovable_ai'))
-- polluent encore la base — wipe_seed_data() ne couvre QUE is_seed=true.
--
-- Ces RPC sont SECURITY DEFINER (bypass RLS) et réservées au service_role :
-- elles sont appelées par l'Edge Function `presse-maintenance` après un
-- contrôle de rôle admin.
--
-- TOUTES les fonctions acceptent p_dry_run (default true) : en dry-run elles
-- ne mutent rien et retournent seulement les compteurs de ce qui SERAIT fait.
-- =========================================================================

-- Clause SQL réutilisable pour cibler les signaux PRESSE (= ni Pappers ni
-- LinkedIn). Alignée sur excludeSourceNames:['LinkedIn','Pappers'] +
-- excludeTypes Pappers/LinkedIn utilisés côté front (src/hooks/useSignals.ts).
-- On ne peut pas factoriser une clause WHERE en SQL pur, donc elle est
-- répétée dans chaque fonction (volontairement, pour lisibilité).

-- -------------------------------------------------------------------------
-- 1) RAPPORT — compteurs, aucune mutation
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_maintenance_report()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'contacts_stuck', (
      SELECT COUNT(*) FROM signals s
      WHERE COALESCE(s.is_seed,false) = false
        AND s.source_name IS DISTINCT FROM 'Pappers'
        AND s.source_name IS DISTINCT FROM 'LinkedIn'
        AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
        AND s.enrichment_status IN ('manus_processing','processing','pending')
    ),
    'contacts_failed', (
      SELECT COUNT(*) FROM signals s
      WHERE COALESCE(s.is_seed,false) = false
        AND s.source_name IS DISTINCT FROM 'Pappers'
        AND s.source_name IS DISTINCT FROM 'LinkedIn'
        AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
        AND s.enrichment_status = 'failed'
    ),
    'logos_stuck', (
      SELECT COUNT(*) FROM signals s
      WHERE COALESCE(s.is_seed,false) = false
        AND s.source_name IS DISTINCT FROM 'Pappers'
        AND s.source_name IS DISTINCT FROM 'LinkedIn'
        AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
        AND s.logo_manus_task_id IS NOT NULL
        AND s.company_logo_url IS NULL
    ),
    'logos_missing', (
      SELECT COUNT(*) FROM signals s
      WHERE COALESCE(s.is_seed,false) = false
        AND s.source_name IS DISTINCT FROM 'Pappers'
        AND s.source_name IS DISTINCT FROM 'LinkedIn'
        AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
        AND s.logo_manus_task_id IS NULL
        AND s.company_logo_url IS NULL
    ),
    'problemes', (
      SELECT COUNT(*) FROM signals s
      WHERE s.status = 'probleme'
        AND s.source_name IS DISTINCT FROM 'Pappers'
        AND s.source_name IS DISTINCT FROM 'LinkedIn'
        AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    ),
    'mock_enrichments', (
      SELECT COUNT(*) FROM company_enrichment
      WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed = true
    ),
    'mock_contacts', (
      SELECT COUNT(*) FROM contacts c
      WHERE c.is_seed = true
        OR c.enrichment_id IN (
          SELECT id FROM company_enrichment WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed = true
        )
    )
  );
$$;

-- -------------------------------------------------------------------------
-- 2) RELANCE CONTACTS — reset + ré-enqueue des signaux Presse bloqués
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_relaunch_contacts(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_jobs int := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM signals s
  WHERE COALESCE(s.is_seed,false) = false
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND s.enrichment_status IN ('manus_processing','processing','pending','failed');

  v_count := COALESCE(array_length(v_ids,1),0);

  IF p_dry_run OR v_count = 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'signals_targeted', v_count, 'jobs_enqueued', 0);
  END IF;

  -- (a) annuler les jobs contacts zombies (pending/running) sinon enqueue-enrichment
  --     dédup et bloque la relance (cf. enqueue-enrichment/index.ts:38-51)
  UPDATE enrichment_jobs
  SET status = 'cancelled', finished_at = now()
  WHERE signal_id = ANY(v_ids) AND job_type = 'contacts' AND status IN ('pending','running');

  -- (b) sortir company_enrichment de 'completed' n'est pas nécessaire (on ne cible
  --     que les non-complétés), mais on remet à 'pending' les rows manus_processing/
  --     failed/processing pour éviter l'early-return "already enriched" si jamais.
  UPDATE company_enrichment
  SET status = 'pending', updated_at = now()
  WHERE signal_id = ANY(v_ids) AND status <> 'completed';

  -- (c) reset du statut d'enrichissement du signal
  UPDATE signals SET enrichment_status = 'none' WHERE id = ANY(v_ids);

  -- (d) ré-enqueue un job contacts frais par signal (le worker le dépile chaque
  --     minute et appelle trigger-manus-enrichment qui lira la NOUVELLE clé Manus)
  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 5 FROM unnest(v_ids) AS s;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  RETURN jsonb_build_object('dry_run', false, 'signals_targeted', v_count, 'jobs_enqueued', v_jobs);
END;
$$;

-- -------------------------------------------------------------------------
-- 3) RÉSOLUTION PROBLÈMES — relance contacts + repasse status='new'
--    (les logos de ces signaux sont relancés par l'Edge Function en parallèle)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_resolve_problemes(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_count int;
  v_jobs int := 0;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM signals s
  WHERE s.status = 'probleme'
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND s.signal_type NOT IN ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement');

  v_count := COALESCE(array_length(v_ids,1),0);

  IF p_dry_run OR v_count = 0 THEN
    RETURN jsonb_build_object('dry_run', p_dry_run, 'problemes_targeted', v_count, 'signal_ids', to_jsonb(COALESCE(v_ids, ARRAY[]::uuid[])));
  END IF;

  UPDATE enrichment_jobs
  SET status = 'cancelled', finished_at = now()
  WHERE signal_id = ANY(v_ids) AND job_type = 'contacts' AND status IN ('pending','running');

  UPDATE company_enrichment
  SET status = 'pending', updated_at = now()
  WHERE signal_id = ANY(v_ids) AND status <> 'completed';

  -- reset enrichissement + sortir du statut 'probleme' (= résolu, revient au flux normal)
  UPDATE signals SET enrichment_status = 'none', status = 'new' WHERE id = ANY(v_ids);

  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 7 FROM unnest(v_ids) AS s; -- priorité un cran au-dessus
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- on renvoie les ids pour que l'Edge Function relance aussi les logos
  RETURN jsonb_build_object('dry_run', false, 'problemes_targeted', v_count, 'jobs_enqueued', v_jobs, 'signal_ids', to_jsonb(v_ids));
END;
$$;

-- -------------------------------------------------------------------------
-- 4) PURGE MOCKS — supprime contacts + enrichissements mock/lovable_ai/seed
--    et remet les signaux concernés en enrichment_status='none'
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presse_wipe_mocks(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enr_ids uuid[];
  v_signal_ids uuid[];
  v_contacts_count int;
  v_enr_count int;
  v_deleted_contacts int := 0;
  v_deleted_enr int := 0;
BEGIN
  SELECT array_agg(id), array_agg(DISTINCT signal_id)
  INTO v_enr_ids, v_signal_ids
  FROM company_enrichment
  WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed = true;

  v_enr_count := COALESCE(array_length(v_enr_ids,1),0);

  SELECT COUNT(*) INTO v_contacts_count
  FROM contacts c
  WHERE c.is_seed = true
     OR (v_enr_ids IS NOT NULL AND c.enrichment_id = ANY(v_enr_ids));

  IF p_dry_run THEN
    RETURN jsonb_build_object('dry_run', true, 'mock_contacts', v_contacts_count, 'mock_enrichments', v_enr_count);
  END IF;

  -- supprimer d'abord les contacts (FK vers enrichment)
  DELETE FROM contacts c
  WHERE c.is_seed = true
     OR (v_enr_ids IS NOT NULL AND c.enrichment_id = ANY(v_enr_ids));
  GET DIAGNOSTICS v_deleted_contacts = ROW_COUNT;

  DELETE FROM company_enrichment
  WHERE enrichment_source IN ('mock','lovable_ai') OR is_seed = true;
  GET DIAGNOSTICS v_deleted_enr = ROW_COUNT;

  -- remettre les signaux concernés en 'none' (ils avaient peut-être enrichment_status
  -- ='completed' avec des contacts fictifs — ils repassent en non-enrichis)
  IF v_signal_ids IS NOT NULL THEN
    UPDATE signals SET enrichment_status = 'none'
    WHERE id = ANY(v_signal_ids) AND enrichment_status <> 'none';
  END IF;

  RETURN jsonb_build_object(
    'dry_run', false,
    'deleted_contacts', v_deleted_contacts,
    'deleted_enrichments', v_deleted_enr,
    'signals_reset', COALESCE(array_length(v_signal_ids,1),0)
  );
END;
$$;

-- -------------------------------------------------------------------------
-- Permissions : service_role uniquement
-- -------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.presse_maintenance_report() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_relaunch_contacts(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_resolve_problemes(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.presse_wipe_mocks(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presse_maintenance_report() TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_relaunch_contacts(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_resolve_problemes(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.presse_wipe_mocks(boolean) TO service_role;

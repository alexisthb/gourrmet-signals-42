-- =========================================================================
-- Purge des faux contacts (gabarits Manus / mocks) + relance Manus en
-- conversations neuves avec la NOUVELLE clé API.
--
-- DÉTECTION : un faux contact = un full_name qui apparaît sur >= N
-- entreprises distinctes (≥10 par défaut). Diagnostic vu sur la base :
--   Sophie Dubois : 186 entreprises  |  Marc Lefebvre : 165
--   David Martin  :  51              |  ... 18 noms ≥10 = 673 contacts
-- Un vrai humain ne travaille pas dans N entreprises à la fois → mock injecté
-- directement, sans contrôle d'unicité.
--
-- PURGE : globale (toutes sources). On supprime PARTOUT où le gabarit existe.
-- RELANCE Manus : Presse uniquement + score >= 4 (Pappers/LinkedIn ne font pas
-- de Manus contacts ; on n'utilise les crédits que sur les leads vendables).
--
-- INCLUT AUSSI dans la relance les signaux Presse score>=4 actuellement
-- bloqués en enrichment_status pending/processing/manus_processing (les "49
-- en vol" du diagnostic). Cron-check-manus ne les sort jamais de cet état si
-- la tâche distante a foiré → ils restent zombies.
--
-- Transactionnel : si quelque chose casse, TOUT est annulé.
-- p_dry_run=true par défaut. SECURITY DEFINER + service_role.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.presse_purge_fake_contacts_and_relaunch(
  p_dry_run        boolean DEFAULT true,
  p_min_companies  int     DEFAULT 10,
  p_min_score      int     DEFAULT 4
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fake_names           text[];
  v_fake_name_count      int := 0;
  v_purge_count          int := 0;
  v_signals_lost_contacts uuid[];
  v_signals_stuck        uuid[];
  v_signals_to_relaunch  uuid[];
  v_jobs_cancelled       int := 0;
  v_enr_reset            int := 0;
  v_jobs_enqueued        int := 0;
  v_sample               jsonb;
BEGIN
  -- 1) Identifier les gabarits (full_name récurrent sur N entreprises distinctes).
  --    Périmètre : TOUTES les sources — fakeness ≠ provenance.
  SELECT array_agg(full_name) INTO v_fake_names
  FROM (
    SELECT c.full_name
    FROM contacts c
    WHERE c.full_name IS NOT NULL AND c.full_name <> ''
    GROUP BY c.full_name
    HAVING COUNT(DISTINCT c.signal_id) >= p_min_companies
  ) t;
  v_fake_name_count := COALESCE(array_length(v_fake_names,1),0);

  -- 2) Pré-compteur des contacts qui tomberont
  SELECT COUNT(*) INTO v_purge_count
  FROM contacts WHERE full_name = ANY(v_fake_names);

  -- 3) Signals Presse score>=p_min_score qui vont perdre des contacts
  SELECT array_agg(DISTINCT c.signal_id) INTO v_signals_lost_contacts
  FROM contacts c JOIN signals s ON s.id = c.signal_id
  WHERE c.full_name = ANY(v_fake_names)
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND COALESCE(s.score,0) >= p_min_score;

  -- 4) Signals Presse score>=p_min_score bloqués en vol (Manus zombies)
  SELECT array_agg(s.id) INTO v_signals_stuck
  FROM signals s
  WHERE s.enrichment_status IN ('pending','processing','manus_processing')
    AND s.source_name IS DISTINCT FROM 'Pappers'
    AND s.source_name IS DISTINCT FROM 'LinkedIn'
    AND COALESCE(s.signal_type,'') NOT IN
        ('anniversary','capital_increase','transfer','creation','radiation','linkedin_engagement')
    AND COALESCE(s.score,0) >= p_min_score;

  -- 5) Union dédupliquée des signals à relancer
  SELECT array_agg(DISTINCT id) INTO v_signals_to_relaunch FROM (
    SELECT unnest(COALESCE(v_signals_lost_contacts, ARRAY[]::uuid[])) AS id
    UNION
    SELECT unnest(COALESCE(v_signals_stuck,         ARRAY[]::uuid[])) AS id
  ) u;

  -- 6) Échantillon des gabarits (top 30 par nb d'entreprises)
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) INTO v_sample FROM (
    SELECT jsonb_build_object('full_name', full_name, 'nb_entreprises', nb) x
    FROM (
      SELECT c.full_name, COUNT(DISTINCT c.signal_id) AS nb
      FROM contacts c
      WHERE c.full_name = ANY(v_fake_names)
      GROUP BY c.full_name
      ORDER BY nb DESC
      LIMIT 30
    ) g
  ) y;

  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'min_companies', p_min_companies,
      'min_score', p_min_score,
      'fake_names_detected', v_fake_name_count,
      'contacts_to_purge', v_purge_count,
      'signals_lost_contacts', COALESCE(array_length(v_signals_lost_contacts,1),0),
      'signals_stuck_in_flight', COALESCE(array_length(v_signals_stuck,1),0),
      'signals_to_relaunch_total', COALESCE(array_length(v_signals_to_relaunch,1),0),
      'sample_fake_names', v_sample
    );
  END IF;

  -- =================== EXÉCUTION ===================

  -- A) Purge globale des contacts gabarits
  DELETE FROM contacts WHERE full_name = ANY(v_fake_names);
  GET DIAGNOSTICS v_purge_count = ROW_COUNT;

  -- B) Annuler les jobs contacts zombies sur les signals à relancer (sinon
  --    enqueue-enrichment dédup et bloque la relance)
  UPDATE enrichment_jobs
  SET status = 'cancelled', finished_at = now()
  WHERE signal_id = ANY(v_signals_to_relaunch)
    AND job_type = 'contacts'
    AND status IN ('pending','running');
  GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

  -- C) Sortir company_enrichment des statuts bloquants pour que
  --    trigger-manus-enrichment refasse une NOUVELLE conversation
  UPDATE company_enrichment
  SET status = 'pending', updated_at = now()
  WHERE signal_id = ANY(v_signals_to_relaunch) AND status <> 'completed';
  GET DIAGNOSTICS v_enr_reset = ROW_COUNT;

  -- D) Reset enrichment_status sur les signals
  UPDATE signals SET enrichment_status = 'none'
  WHERE id = ANY(v_signals_to_relaunch);

  -- E) Ré-enqueue un job contacts frais par signal — le worker le dépile et
  --    appellera trigger-manus-enrichment qui lira la NOUVELLE clé Manus,
  --    démarrant une conversation neuve (l'ancien task_id zombie est ignoré).
  INSERT INTO enrichment_jobs (signal_id, job_type, status, priority)
  SELECT s, 'contacts', 'pending', 7 FROM unnest(v_signals_to_relaunch) AS s;
  GET DIAGNOSTICS v_jobs_enqueued = ROW_COUNT;

  RETURN jsonb_build_object(
    'dry_run', false,
    'min_companies', p_min_companies,
    'min_score', p_min_score,
    'fake_names_purged', v_fake_name_count,
    'contacts_deleted', v_purge_count,
    'signals_relaunched', COALESCE(array_length(v_signals_to_relaunch,1),0),
    'jobs_cancelled', v_jobs_cancelled,
    'enrichments_reset', v_enr_reset,
    'jobs_enqueued', v_jobs_enqueued,
    'sample_fake_names', v_sample
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.presse_purge_fake_contacts_and_relaunch(boolean,int,int)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.presse_purge_fake_contacts_and_relaunch(boolean,int,int)
  TO service_role;

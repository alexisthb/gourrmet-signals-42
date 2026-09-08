-- « AUCUNE DE CELLES-CI » DOIT SORTIR LA FICHE DU TRAVAIL À FAIRE.
--
-- Demandé par l'opératrice le 08/09 : quand elle confirme qu'aucune entreprise
-- proposée ne correspond, la fiche quittait bien la file « À identifier »,
-- mais restait « Nouveau » dans le reste de l'outil. Elle la retrouvait donc
-- dans ses listes de signaux à traiter, sans aucune trace de la décision
-- qu'elle venait de prendre — et devait la re-juger à chaque passage.
--
-- Une décision d'opératrice qui ne se voit qu'à un seul endroit n'est pas une
-- décision : c'est une note privée. Elle vaut ici classement.
--
-- On reprend MOT POUR MOT la convention de l'archivage automatique des
-- signaux périmés (20260822130000) — statut `ignored`, pipeline `archived`,
-- note DATÉE AJOUTÉE au bloc-notes sans jamais l'écraser — pour qu'une fiche
-- écartée à la main et une fiche écartée par l'horizon se lisent pareil.
--
-- Deux garde-fous, repris du même précédent :
--   • seul un signal encore `new` est classé : jamais un signal déjà travaillé
--     (contacté, en relation, gagné…). Se tromper dans ce sens effacerait du
--     travail commercial réel ;
--   • jamais un signal qui porte des contacts : la question d'identité ne se
--     pose plus, et l'écarter ferait perdre des interlocuteurs déjà trouvés.

CREATE OR REPLACE FUNCTION public.resolve_company_identity(
  p_signal_id uuid,
  p_decision text,
  p_linkedin_url text DEFAULT NULL,
  p_chosen_name text DEFAULT NULL,
  p_actor text DEFAULT 'operateur'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_signal public.signals%ROWTYPE;
  v_candidates jsonb;
  v_resolution_id uuid;
  v_relaunch jsonb;
  v_archive integer := 0;
  v_url text := nullif(btrim(coalesce(p_linkedin_url, '')), '');
  v_name text := nullif(btrim(coalesce(p_chosen_name, '')), '');
  v_actor text := coalesce(nullif(btrim(coalesce(p_actor, '')), ''), 'operateur');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.is_internal_user() THEN
    RAISE EXCEPTION 'Accès interne requis' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('pinned', 'none_of_these') THEN
    RAISE EXCEPTION 'decision invalide: %', p_decision USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_signal FROM public.signals WHERE id = p_signal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signal inconnu: %', p_signal_id USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'pinned' THEN
    -- Seule une PAGE ENTREPRISE LinkedIn est acceptée : c'est exactement ce
    -- que l'étage employés consomme. Un profil personnel ou un site web ici
    -- produirait un échec incompréhensible trois étages plus loin.
    IF v_url IS NULL
       OR v_url !~* '^https://([a-z0-9-]+\.)?linkedin\.com/company/.+' THEN
      RAISE EXCEPTION
        'URL de page entreprise LinkedIn requise (https://www.linkedin.com/company/...)'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    v_url := NULL;
  END IF;

  SELECT coalesce(ce.resolution_provenance->'candidates', '[]'::jsonb)
    INTO v_candidates
  FROM public.company_enrichment ce
  WHERE ce.signal_id = p_signal_id;

  INSERT INTO public.company_identity_resolutions
    (signal_id, company_name, company_key, decision, chosen_name, linkedin_url,
     source_candidates, resolved_by)
  VALUES
    (p_signal_id, v_signal.company_name,
     public.normalize_company_identity_key(v_signal.company_name),
     p_decision, v_name, v_url, coalesce(v_candidates, '[]'::jsonb), v_actor)
  RETURNING id INTO v_resolution_id;

  IF p_decision = 'none_of_these' THEN
    -- La fiche est classée : elle disparaît des listes de travail au lieu d'y
    -- revenir en « Nouveau » à chaque passage. Aucun run fournisseur n'est
    -- dépensé : on n'identifie pas une entreprise que l'humain n'identifie pas.
    WITH classes AS (
      UPDATE public.signals s
      SET status = 'ignored',
          pipeline_status = 'archived',
          pipeline_updated_at = now(),
          notes = coalesce(nullif(btrim(s.notes), '') || E'\n', '')
                  || '[' || to_char(now(), 'YYYY-MM-DD') || '] Écarté par '
                  || v_actor || ' : entreprise non identifiable sur LinkedIn '
                  || '(aucune des pages proposées ne correspond).'
      WHERE s.id = p_signal_id
        AND s.status = 'new'
        AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
      RETURNING 1
    )
    SELECT count(*) INTO v_archive FROM classes;

    RETURN jsonb_build_object(
      'state', 'marked_unidentifiable',
      'resolution_id', v_resolution_id,
      'archive', v_archive > 0
    );
  END IF;

  -- Relance par le chemin canonique : motif tracé, historique supplanté sans
  -- effacement, zéro cooldown. L'épinglage sera lu au dispatch et remplacera
  -- la recherche fournisseur. Si un job est déjà en vol, authorize refuse
  -- ('job_en_vol') : l'épinglage reste consigné et s'appliquera à la
  -- prochaine génération — on le dit à l'appelant plutôt que de forcer.
  v_relaunch := public.authorize_enrichment_regeneration(
    p_signal_id,
    'Identification manuelle de l''entreprise : ' || coalesce(v_name, v_url),
    v_actor
  );

  RETURN jsonb_build_object(
    'state', 'pinned',
    'resolution_id', v_resolution_id,
    'relaunch', v_relaunch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text)
  TO service_role, authenticated;

COMMENT ON FUNCTION public.resolve_company_identity(uuid, text, text, text, text) IS
  'Geste operatrice de la file « A identifier » : consigne la decision '
  '(pinned = page LinkedIn epinglee + relance canonique sans cooldown ; '
  'none_of_these = introuvable, la fiche passe en ignore/archive avec note '
  'datee, sans aucune relance). La decision epinglee prime ensuite sur toute '
  'recherche fournisseur au dispatch.';

-- Rattrapage des fiches déjà écartées avant ce correctif : elles portent la
-- décision de l'opératrice mais sont restées « Nouveau ». Mêmes garde-fous,
-- donc rejouable sans risque.
UPDATE public.signals s
SET status = 'ignored',
    pipeline_status = 'archived',
    pipeline_updated_at = now(),
    notes = coalesce(nullif(btrim(s.notes), '') || E'\n', '')
            || '[' || to_char(now(), 'YYYY-MM-DD') || '] Écarté : entreprise '
            || 'non identifiable sur LinkedIn (décision antérieure au '
            || 'classement automatique).'
WHERE s.status = 'new'
  AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.signal_id = s.id)
  AND EXISTS (
    SELECT 1 FROM public.company_identity_resolutions r
    WHERE r.signal_id = s.id AND r.decision = 'none_of_these'
  );

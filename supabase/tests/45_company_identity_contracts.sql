-- Contrats de la file « À identifier » (20260904170000).
--
-- L'enjeu : quand la résolution société hésite (Arval) ou déraille (Pasqal),
-- la décision revient à un humain — et cette décision doit (1) n'être proposée
-- que pour de VRAIES questions d'identité, (2) être consignée et traçable,
-- (3) relancer l'enrichissement par le chemin canonique sans cooldown,
-- (4) primer ensuite sur toute recherche fournisseur. Si ces assertions
-- tombent, soit la file spamme l'opératrice avec des pannes techniques, soit
-- son clic ne relance rien — dans les deux cas l'écran ment.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  s_ambigu uuid; s_memoire uuid; s_panne uuid; s_deja uuid;
  s_fantome uuid; s_futur uuid;
  j_ambigu uuid;
  res jsonb; n integer;
  v_url text := 'https://www.linkedin.com/company/zzident-arval-group';
  v_row record;
BEGIN
  DELETE FROM public.company_identity_resolutions
   WHERE company_name LIKE 'ZZIDENT%';
  DELETE FROM public.contacts
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZIDENT%');
  DELETE FROM public.enrichment_jobs
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZIDENT%');
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZIDENT%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZIDENT%';

  -- ------------------- la clé de rapprochement est frugale -------------------
  ASSERT public.normalize_company_identity_key('Crédit Agricole S.A.') = 'creditagricolesa',
    'la cle doit plier accents et ponctuation';
  ASSERT public.normalize_company_identity_key('PASQAL')
       = public.normalize_company_identity_key('Pasqal'),
    'la cle doit rapprocher les casses differentes';

  -- ============ le cas nominal : une vraie hésitation, avec mémoire ============
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT Arval', 'nomination', 4, 'new', now()) RETURNING id INTO s_ambigu;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     error_message, resolution_provenance)
  VALUES
    (s_ambigu, 'ZZIDENT Arval', 'failed', 'ambiguous', 'completed',
     'LinkedIn (Apify) : Résolution société ambiguous: top_candidates_too_close',
     jsonb_build_object(
       'reason', 'top_candidates_too_close',
       'candidates', jsonb_build_array(
         jsonb_build_object('name', 'ZZIDENT Arval Group', 'linkedin_url', v_url,
                            'score', 53, 'evidence', jsonb_build_array('containment:1.00')),
         jsonb_build_object('name', 'ZZIDENT Arval Archi', 'linkedin_url',
                            'https://www.linkedin.com/company/zzident-arval-archi',
                            'score', 49, 'evidence', jsonb_build_array('containment:1.00'))
       )));
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, finished_at, error_message)
  VALUES (s_ambigu, 'contacts', 'failed', now() - interval '1 hour',
          'Résolution société ambiguous: top_candidates_too_close')
  RETURNING id INTO j_ambigu;

  -- Un autre signal du MÊME nom, résolu fort par le passé : sa page doit être
  -- re-proposée (le fournisseur est capricieux — vécu Pasqal 30/08 vs 04/09).
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT ARVAL', 'anniversaire', 5, 'new', now() - interval '5 days')
  RETURNING id INTO s_memoire;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     linkedin_company_url, resolution_provenance)
  VALUES
    (s_memoire, 'ZZIDENT ARVAL', 'completed', 'resolved', NULL, v_url,
     jsonb_build_object('reason', 'strong_unique_match',
       'candidates', jsonb_build_array(
         jsonb_build_object('name', 'ZZIDENT Arval Group', 'linkedin_url', v_url,
                            'score', 100, 'evidence', jsonb_build_array('exact_normalized_name')))));

  -- Une panne technique n'est PAS une question d'identité : hors file.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT Panne', 'levee', 3, 'new', now()) RETURNING id INTO s_panne;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     resolution_provenance)
  VALUES (s_panne, 'ZZIDENT Panne', 'failed', 'rejected', 'failed',
          jsonb_build_object('reason', 'provider_network_error', 'candidates', '[]'::jsonb));

  -- Un signal qui a déjà des contacts n'a plus de question à poser : hors file.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT Deja', 'ma', 3, 'new', now()) RETURNING id INTO s_deja;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     resolution_provenance)
  VALUES (s_deja, 'ZZIDENT Deja', 'failed', 'ambiguous', 'completed',
          jsonb_build_object('reason', 'top_candidates_too_close', 'candidates', '[]'::jsonb));
  INSERT INTO public.contacts (signal_id, full_name)
  VALUES (s_deja, 'ZZIDENT Contact Existant');

  SELECT count(*) INTO n FROM public.company_identifications_pending
   WHERE company_name LIKE 'ZZIDENT%';
  ASSERT n = 1,
    'seule la vraie hesitation doit etre en file (obtenu: ' || n || ')';
  SELECT * INTO v_row FROM public.company_identifications_pending
   WHERE signal_id = s_ambigu;
  ASSERT FOUND, 'le signal ambigu doit etre en file';
  ASSERT jsonb_array_length(v_row.candidates) = 2,
    'les candidates de la derniere tentative doivent etre portees par la file';
  ASSERT v_row.previously_resolved_url = v_url,
    'l identite deja resolue du meme nom doit etre re-proposee';
  ASSERT v_row.previously_resolved_name = 'ZZIDENT Arval Group',
    'le nom de l identite deja resolue doit accompagner son URL';
  ASSERT v_row.resolution_reason = 'top_candidates_too_close',
    'le motif d hesitation doit etre expose pour etre humanise a l ecran';

  -- ------------------------- les gestes invalides -------------------------
  BEGIN
    res := public.resolve_company_identity(s_ambigu, 'pinned', 'https://zzident.example.com', 'X', 'test');
    ASSERT false, 'une URL non-LinkedIn doit etre refusee';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    res := public.resolve_company_identity(s_ambigu, 'peut_etre', v_url, 'X', 'test');
    ASSERT false, 'une decision inconnue doit etre refusee';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    res := public.resolve_company_identity(gen_random_uuid(), 'pinned', v_url, 'X', 'test');
    ASSERT false, 'un signal inconnu doit etre refuse';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.company_identity_resolutions
   WHERE company_name LIKE 'ZZIDENT%';
  ASSERT n = 0, 'un refus ne doit consigner AUCUNE decision';

  -- --------------- le garde d'accès tient sans rôle interne ---------------
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    res := public.resolve_company_identity(s_ambigu, 'pinned', v_url, 'X', 'test');
    ASSERT false, 'sans role interne, le geste doit etre refuse';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- ========================= l'épinglage nominal =========================
  res := public.resolve_company_identity(
    s_ambigu, 'pinned', v_url, 'ZZIDENT Arval Group', 'clotilde');
  ASSERT res->>'state' = 'pinned',
    'l epinglage doit aboutir (obtenu: ' || (res->>'state') || ')';
  ASSERT res->'relaunch'->>'state' = 'authorized',
    'l epinglage doit relancer par le chemin canonique (obtenu: '
      || (res->'relaunch'->>'state') || ')';
  ASSERT res->'relaunch'->'enqueue'->>'state' = 'enqueued',
    'la relance doit reellement remettre un job en file (obtenu: '
      || (res->'relaunch'->'enqueue'->>'state') || ')';

  -- La décision est consignée, complète.
  SELECT count(*) INTO n FROM public.company_identity_resolutions
   WHERE signal_id = s_ambigu AND decision = 'pinned'
     AND linkedin_url = v_url AND chosen_name = 'ZZIDENT Arval Group'
     AND resolved_by = 'clotilde'
     AND company_key = public.normalize_company_identity_key('ZZIDENT Arval')
     AND jsonb_array_length(source_candidates) = 2;
  ASSERT n = 1, 'la decision doit etre consignee integralement (candidates comprises)';

  -- La mécanique canonique a fait son travail : ancien job supplanté, un seul
  -- job actif, fiche repartie en pending, cooldown ignoré (échec d'il y a 1 h).
  ASSERT (SELECT status FROM public.enrichment_jobs WHERE id = j_ambigu) = 'cancelled',
    'le job echoue doit etre supplante, pas efface';
  SELECT count(*) INTO n FROM public.enrichment_jobs
   WHERE signal_id = s_ambigu AND status IN ('pending', 'running');
  ASSERT n = 1, 'exactement un job actif doit repartir';
  ASSERT (SELECT status FROM public.company_enrichment WHERE signal_id = s_ambigu) = 'pending',
    'la fiche doit repartir en pending';

  -- Et le signal sort de la file.
  SELECT count(*) INTO n FROM public.company_identifications_pending
   WHERE signal_id = s_ambigu;
  ASSERT n = 0, 'un signal tranche doit sortir de la file';

  -- ===================== « aucune de celles-ci » =====================
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT Fantome', 'distinction', 2, 'new', now()) RETURNING id INTO s_fantome;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     resolution_provenance)
  VALUES (s_fantome, 'ZZIDENT Fantome', 'failed', 'rejected', 'completed',
          jsonb_build_object('reason', 'no_candidate', 'candidates', '[]'::jsonb));

  res := public.resolve_company_identity(s_fantome, 'none_of_these', NULL, NULL, 'clotilde');
  ASSERT res->>'state' = 'marked_unidentifiable',
    'aucune candidate = consigne sans relance (obtenu: ' || (res->>'state') || ')';
  SELECT count(*) INTO n FROM public.enrichment_jobs
   WHERE signal_id = s_fantome AND status IN ('pending', 'running');
  ASSERT n = 0, 'aucune relance ne doit partir pour une entreprise introuvable';
  SELECT count(*) INTO n FROM public.company_identifications_pending
   WHERE signal_id = s_fantome;
  ASSERT n = 0, 'une entreprise marquee introuvable doit sortir de la file';
  SELECT count(*) INTO n FROM public.company_identity_resolutions
   WHERE signal_id = s_fantome AND decision = 'none_of_these' AND linkedin_url IS NULL;
  ASSERT n = 1, 'la decision "aucune" doit etre consignee, sans URL';

  -- ============ l'épinglage devient la mémoire des prochains ============
  -- Un futur signal du même nom (casse et ponctuation différentes) doit se
  -- voir proposer la page ÉPINGLÉE en priorité sur la résolution passée.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZIDENT arval !', 'expansion', 4, 'new', now()) RETURNING id INTO s_futur;
  INSERT INTO public.company_enrichment
    (signal_id, company_name, status, resolution_status, resolution_technical_status,
     resolution_provenance)
  VALUES (s_futur, 'ZZIDENT arval !', 'failed', 'ambiguous', 'completed',
          jsonb_build_object('reason', 'match_not_strong_enough', 'candidates', '[]'::jsonb));

  SELECT * INTO v_row FROM public.company_identifications_pending
   WHERE signal_id = s_futur;
  ASSERT FOUND, 'le futur signal du meme nom doit etre en file';
  ASSERT v_row.previously_resolved_url = v_url
     AND v_row.previously_resolved_name = 'ZZIDENT Arval Group',
    'l epinglage anterieur doit etre re-propose aux signaux suivants du meme nom';

  RAISE NOTICE 'contrats file « À identifier » : OK';
END $$;

-- Nettoyage : le banc se rejoue.
DELETE FROM public.company_identity_resolutions WHERE company_name LIKE 'ZZIDENT%';
DELETE FROM public.contacts
 WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZIDENT%');
DELETE FROM public.enrichment_jobs
 WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZIDENT%');
DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZIDENT%';
DELETE FROM public.signals WHERE company_name LIKE 'ZZIDENT%';

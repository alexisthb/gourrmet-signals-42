-- Contrats de l'horizon commercial des signaux (20260822130000 / 140000).
--
-- Ce que ces assertions protègent : la frontière entre « poids mort » et
-- « prospect encore appelable ». La règle des 60 jours archive des signaux en
-- masse ; une erreur de bord y est invisible et coûte des prospects payés.
--
-- Elles APPELLENT les fonctions au lieu de se contenter de vérifier qu'elles
-- existent. Le 2026-08-22, une migration de quota syntaxiquement valide mais
-- fonctionnellement fausse est passée au vert sur ce banc, précisément parce
-- qu'aucun contrat ne l'exécutait.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_res jsonb;
  v_vieux_sans_contact uuid;
  v_vieux_avec_contact uuid;
  v_vieux_deja_contacte uuid;
  v_recent uuid;
  v_statut text;
  v_notes text;
BEGIN
  DELETE FROM public.contacts  WHERE full_name LIKE 'ZZEXP%';
  DELETE FROM public.signals   WHERE company_name LIKE 'ZZEXP%';

  -- ═══ Les quatre cas de bord, posés côte à côte ═══

  -- 1. Vieux, jamais travaillé, aucun contact : LE poids mort. Doit être archivé.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at, notes)
  VALUES ('ZZEXP mort', 'levee', 5, 'new', now() - interval '200 days', 'note existante')
  RETURNING id INTO v_vieux_sans_contact;

  -- 2. Vieux MAIS porteur de contacts : coordonnées déjà payées chez Apify et
  --    Dropcontact. Doit survivre — c'est l'arbitrage du 2026-08-22.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZEXP joignable', 'levee', 5, 'new', now() - interval '200 days')
  RETURNING id INTO v_vieux_avec_contact;
  INSERT INTO public.contacts (signal_id, full_name)
  VALUES (v_vieux_avec_contact, 'ZZEXP Contact Utile');

  -- 3. Vieux et DÉJÀ TRAVAILLÉ par l'opératrice : un statut commercial ne se
  --    réécrit jamais automatiquement.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZEXP travaille', 'levee', 5, 'contacted', now() - interval '200 days')
  RETURNING id INTO v_vieux_deja_contacte;

  -- 4. Récent : hors périmètre, quoi qu'il arrive.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZEXP recent', 'levee', 5, 'new', now() - interval '3 days')
  RETURNING id INTO v_recent;

  -- ═══ La simulation ne doit RIEN modifier ═══
  v_res := public.expire_stale_signals(60, true);
  ASSERT (v_res->>'simulation')::boolean,
    'p_dry_run doit se declarer comme une simulation';
  SELECT status INTO v_statut FROM public.signals WHERE id = v_vieux_sans_contact;
  ASSERT v_statut = 'new',
    'une simulation ne doit modifier aucun statut (obtenu: ' || v_statut || ')';

  -- ═══ L'exécution réelle ═══
  v_res := public.expire_stale_signals(60, false);

  SELECT status INTO v_statut FROM public.signals WHERE id = v_vieux_sans_contact;
  ASSERT v_statut = 'ignored',
    'un signal vieux et sans contact doit etre archive (obtenu: ' || v_statut || ')';

  SELECT status INTO v_statut FROM public.signals WHERE id = v_vieux_avec_contact;
  ASSERT v_statut = 'new',
    'un signal PORTEUR DE CONTACTS ne doit JAMAIS etre archive, quel que soit '
    'son age (obtenu: ' || v_statut || ')';

  SELECT status INTO v_statut FROM public.signals WHERE id = v_vieux_deja_contacte;
  ASSERT v_statut = 'contacted',
    'un statut commercial ne doit jamais etre ecrase (obtenu: ' || v_statut || ')';

  SELECT status INTO v_statut FROM public.signals WHERE id = v_recent;
  ASSERT v_statut = 'new',
    'un signal dans l horizon doit rester intact (obtenu: ' || v_statut || ')';

  -- Le bloc-notes de l'opératrice est AJOUTÉ, jamais écrasé.
  SELECT notes INTO v_notes FROM public.signals WHERE id = v_vieux_sans_contact;
  ASSERT v_notes LIKE '%note existante%',
    'la note preexistante doit survivre a l archivage (obtenu: '
      || coalesce(v_notes, 'NULL') || ')';
  ASSERT v_notes LIKE '%Archive automatiquement%' OR v_notes LIKE '%Archivé automatiquement%',
    'l archivage doit laisser une trace lisible dans les notes';

  -- ═══ Un horizon absurde doit être refusé, pas appliqué ═══
  -- Sans cette borne, `expire_stale_signals(0)` archiverait tout le stock.
  BEGIN
    v_res := public.expire_stale_signals(0, true);
    ASSERT false, 'un horizon de 0 jour doit etre refuse';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  DELETE FROM public.contacts WHERE full_name LIKE 'ZZEXP%';
  DELETE FROM public.signals  WHERE company_name LIKE 'ZZEXP%';
  RAISE NOTICE 'OK — horizon commercial : archive le poids mort, preserve les prospects joignables';
END $$;

-- ═══ Le backlog d'enrichissement suit le même horizon ═══
-- Proposer d'enrichir un signal qu'on vient d'archiver engagerait une dépense
-- fournisseur sur une accroche morte.
DO $$
DECLARE
  v_vieux uuid;
  v_present boolean;
BEGIN
  DELETE FROM public.signals WHERE company_name LIKE 'ZZBACK%';

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZBACK perime', 'levee', 5, 'new', now() - interval '200 days')
  RETURNING id INTO v_vieux;

  SELECT EXISTS (SELECT 1 FROM public.enrichment_backlog WHERE id = v_vieux)
    INTO v_present;
  ASSERT NOT v_present,
    'un signal hors horizon ne doit plus figurer au backlog d enrichissement';

  UPDATE public.signals SET detected_at = now() - interval '5 days' WHERE id = v_vieux;
  SELECT EXISTS (SELECT 1 FROM public.enrichment_backlog WHERE id = v_vieux)
    INTO v_present;
  ASSERT v_present,
    'un signal dans l horizon, sans contact et sans job, doit figurer au backlog';

  DELETE FROM public.signals WHERE company_name LIKE 'ZZBACK%';
  RAISE NOTICE 'OK — le backlog d enrichissement respecte l horizon commercial';
END $$;

-- ═══ Le plafond Apify reste une borne réelle ═══
-- Une confusion dollars/runs a déjà coûté un blocage d'enrichissement.
DO $$
DECLARE
  v_limite integer;
BEGIN
  SELECT monthly_run_limit INTO v_limite
  FROM public.apify_plan_settings ORDER BY updated_at DESC LIMIT 1;

  ASSERT v_limite IS NULL OR v_limite > 0,
    'le plafond de runs Apify doit rester strictement positif : 0 desarmerait '
    'la reservation de quota sans rien signaler';

  RAISE NOTICE 'OK — plafond de runs Apify borne (%)', coalesce(v_limite::text, 'aucun');
END $$;

-- ═══ Le balayage de famine s'abstient quand un solde fournisseur est bas ═══
-- Un automate qui dépense sans regarder le solde est pire que pas d'automate :
-- il vide la capacité réservée aux signaux frais de la semaine.
DO $$
DECLARE
  v_res jsonb;
  v_limite_initiale integer;
BEGIN
  SELECT monthly_run_limit INTO v_limite_initiale
  FROM public.apify_plan_settings ORDER BY updated_at DESC LIMIT 1;

  -- Dose hors bornes : refusée des deux côtés, jamais devinée.
  BEGIN
    v_res := public.sweep_enrichment_famine(0);
    ASSERT false, 'une dose de 0 doit etre refusee';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    v_res := public.sweep_enrichment_famine(999);
    ASSERT false, 'une dose de 999 doit etre refusee';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  -- Quota Apify ramené sous la réserve : le balayage doit s'abstenir ET dire
  -- pourquoi, plutôt que de dépenser ou d'échouer en silence.
  IF v_limite_initiale IS NOT NULL THEN
    UPDATE public.apify_plan_settings SET monthly_run_limit = 1, updated_at = now();
    v_res := public.sweep_enrichment_famine(5);
    ASSERT NOT (v_res->>'balaye')::boolean,
      'sous la reserve Apify, le balayage doit s abstenir';
    ASSERT v_res->>'motif' LIKE '%Apify%',
      'l abstention doit nommer le fournisseur en cause (obtenu: '
        || coalesce(v_res->>'motif', 'NULL') || ')';
    ASSERT (v_res->>'mis_en_file')::integer = 0,
      'une abstention ne doit mettre aucun signal en file';
    UPDATE public.apify_plan_settings
    SET monthly_run_limit = v_limite_initiale, updated_at = now();
  END IF;

  RAISE NOTICE 'OK — le balayage de famine verifie les soldes avant de depenser';
END $$;

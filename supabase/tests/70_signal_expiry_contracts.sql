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

-- ═══ Les vues d'inspection disent la même chose que les fonctions ═══
-- Une vue de prévisualisation qui diverge de la fonction qu'elle décrit est
-- pire qu'aucune vue : elle donne une confiance fausse.
DO $$
DECLARE
  v_fonction jsonb;
  v_vue record;
  v_vieux uuid;
  v_joignable uuid;
BEGIN
  DELETE FROM public.contacts WHERE full_name LIKE 'ZZPREV%';
  DELETE FROM public.signals  WHERE company_name LIKE 'ZZPREV%';

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZPREV mort', 'levee', 5, 'new', now() - interval '200 days')
  RETURNING id INTO v_vieux;

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZPREV joignable', 'levee', 5, 'new', now() - interval '200 days')
  RETURNING id INTO v_joignable;
  INSERT INTO public.contacts (signal_id, full_name)
  VALUES (v_joignable, 'ZZPREV Contact');

  v_fonction := public.expire_stale_signals(60, true);
  SELECT * INTO v_vue FROM public.signal_expiry_preview;

  ASSERT (v_fonction->>'archiverait')::integer = v_vue.archiverait,
    'la vue et la fonction doivent compter pareil les signaux a archiver ('
      || (v_fonction->>'archiverait') || ' vs ' || v_vue.archiverait || ')';
  ASSERT (v_fonction->>'preserverait_car_ont_des_contacts')::integer
         = v_vue.preserverait_car_ont_des_contacts,
    'la vue et la fonction doivent compter pareil les signaux preserves';
  ASSERT v_vue.horizon_jours = 60,
    'la vue doit rendre l horizon effectivement configure';

  -- La vue est en LECTURE SEULE : la consulter ne doit rien archiver.
  ASSERT (SELECT status FROM public.signals WHERE id = v_vieux) = 'new',
    'consulter la vue de previsualisation ne doit modifier aucun signal';

  DELETE FROM public.contacts WHERE full_name LIKE 'ZZPREV%';
  DELETE FROM public.signals  WHERE company_name LIKE 'ZZPREV%';
  RAISE NOTICE 'OK — la vue de previsualisation dit la meme chose que la fonction';
END $$;

DO $$
DECLARE
  v_verdict text;
BEGIN
  SELECT verdict INTO v_verdict FROM public.enrichment_sweep_readiness;
  ASSERT v_verdict IS NOT NULL,
    'la vue de disponibilite du balayage doit toujours rendre un verdict';
  ASSERT v_verdict LIKE 'PRET%' OR v_verdict LIKE 'ABSTENTION%'
      OR v_verdict LIKE 'RIEN A FAIRE%',
    'le verdict doit etre l un des trois etats prevus (obtenu: ' || v_verdict || ')';
  RAISE NOTICE 'OK — disponibilite du balayage lisible : %', v_verdict;
END $$;

-- ═══ La reprise d'un « completed » VIDE, sur autorisation explicite ═══
-- Constaté le 22/08 : 18 relances autorisées sur 20 refusées already_completed,
-- p_allow_terminal_retry ignoré sur cette branche. Un completed sans contacts
-- est LE motif de la semaine (« ça tourne, ça ne produit pas ») — le protéger
-- comme un succès rendait ces signaux à jamais irretentables.
DO $$
DECLARE
  v_vide uuid; v_pourvu uuid; v_res jsonb;
BEGIN
  DELETE FROM public.contacts WHERE full_name LIKE 'ZZRETRY%';
  DELETE FROM public.enrichment_jobs WHERE signal_id IN
    (SELECT id FROM public.signals WHERE company_name LIKE 'ZZRETRY%');
  DELETE FROM public.signals WHERE company_name LIKE 'ZZRETRY%';

  -- Un signal dont le job est completed avec ZÉRO contact.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZRETRY vide', 'levee', 5, 'new', now() - interval '10 days')
  RETURNING id INTO v_vide;
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, finished_at)
  VALUES (v_vide, 'contacts', 'completed', now() - interval '9 days');

  -- Un signal completed AVEC un contact : jamais redemandé, quota oblige.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZRETRY pourvu', 'levee', 5, 'new', now() - interval '10 days')
  RETURNING id INTO v_pourvu;
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, finished_at)
  VALUES (v_pourvu, 'contacts', 'completed', now() - interval '9 days');
  INSERT INTO public.contacts (signal_id, full_name)
  VALUES (v_pourvu, 'ZZRETRY Contact');

  -- SANS autorisation : refus intact, comme avant.
  v_res := public.enqueue_enrichment_job_authorized(v_vide, 'contacts', 5, 0, false);
  ASSERT v_res->>'state' = 'already_completed',
    'sans autorisation, un completed reste ferme (obtenu: ' || (v_res->>'state') || ')';

  -- AVEC autorisation et zéro contact : enqueue ORIENTE vers le chemin
  -- canonique au lieu d'enfiler un job que le dispatch refuserait. Constaté
  -- le 22/08 : 17 jobs enfilés directement sont morts en aval sur
  -- « nouvelle génération non autorisée » — le contrat testait le maillon,
  -- pas la chaîne.
  v_res := public.enqueue_enrichment_job_authorized(v_vide, 'contacts', 5, 0, true);
  ASSERT v_res->>'state' = 'requires_regeneration_authorization',
    'un completed VIDE autorise doit ORIENTER vers la regeneration canonique '
    '(obtenu: ' || (v_res->>'state') || ')';
  ASSERT v_res->>'hint' LIKE '%authorize_enrichment_regeneration%',
    'l orientation doit nommer le chemin canonique';

  -- ET LA CHAÎNE ABOUTIT : le chemin canonique supersede l'historique et
  -- enfile un job réellement dispatchable.
  v_res := public.authorize_enrichment_regeneration(
    v_vide, 'Contrat 70 : reprise d un completed vide via le chemin canonique', 'banc-sql');
  ASSERT v_res->'enqueue'->>'state' = 'enqueued',
    'authorize doit enfiler apres supersede (obtenu: '
    || coalesce(v_res->'enqueue'->>'state', 'NULL') || ')';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.enrichment_jobs
    WHERE signal_id = v_vide AND status IN ('completed', 'failed')
  ), 'aucun job terminal ne doit subsister apres la regeneration autorisee';

  -- AVEC autorisation mais un contact existant : refus — la dépense
  -- n'achèterait rien.
  v_res := public.enqueue_enrichment_job_authorized(v_pourvu, 'contacts', 5, 0, true);
  ASSERT v_res->>'state' = 'already_completed',
    'un signal POURVU n est jamais redemande, meme autorise (obtenu: '
    || (v_res->>'state') || ')';

  DELETE FROM public.contacts WHERE full_name LIKE 'ZZRETRY%';
  DELETE FROM public.enrichment_jobs WHERE signal_id IN (v_vide, v_pourvu);
  DELETE FROM public.signals WHERE company_name LIKE 'ZZRETRY%';
  RAISE NOTICE 'OK — la reprise couvre les completed vides, et eux seuls';
END $$;

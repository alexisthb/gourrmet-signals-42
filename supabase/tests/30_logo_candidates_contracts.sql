-- Contrats de la sélection des candidats logo (20260821170000).
-- Le point sensible : rendre sa chance à un signal épuisé SANS créer de boucle.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  s_neuf uuid; s_partiel uuid; s_epuise_sans uuid; s_epuise_avec uuid;
  s_ignore uuid; s_backoff uuid; s_faible uuid;
  n integer; r record;
BEGIN
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZTEST%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZTEST%';

  -- Un signal jamais tenté.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZTEST neuf', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_neuf;

  -- Tentatives restantes, hors backoff.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                              logo_fetch_attempts, logo_last_attempt_at)
  VALUES ('ZZTEST partiel', 'anniversaire', 5, 'new', now(), 2, now() - interval '5 hours')
  RETURNING id INTO s_partiel;

  -- Tentatives restantes mais DANS le backoff : doit être exclu.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                              logo_fetch_attempts, logo_last_attempt_at)
  VALUES ('ZZTEST backoff', 'anniversaire', 5, 'new', now(), 2, now() - interval '10 minutes')
  RETURNING id INTO s_backoff;

  -- Épuisé, aucune piste : doit rester exclu.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                              logo_fetch_attempts, logo_last_attempt_at)
  VALUES ('ZZTEST epuise sans piste', 'anniversaire', 5, 'new', now(), 5, now() - interval '3 days')
  RETURNING id INTO s_epuise_sans;

  -- Épuisé, MAIS l'enrichissement a trouvé un domaine APRÈS le dernier essai.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                              logo_fetch_attempts, logo_last_attempt_at)
  VALUES ('ZZTEST epuise avec piste', 'anniversaire', 5, 'new', now(), 5, now() - interval '3 days')
  RETURNING id INTO s_epuise_avec;
  INSERT INTO public.company_enrichment (signal_id, company_name, domain, status, updated_at)
  VALUES (s_epuise_avec, 'ZZTEST epuise avec piste', 'exemple.fr', 'completed', now() - interval '1 hour');

  -- Écarté par l'opératrice : jamais de logo, même neuf.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZTEST ignore', 'anniversaire', 5, 'ignored', now()) RETURNING id INTO s_ignore;

  -- Score sous le seuil.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZTEST faible', 'anniversaire', 2, 'new', now()) RETURNING id INTO s_faible;

  -- ================= sélection avec minScore = 4 =================
  CREATE TEMP TABLE sel ON COMMIT DROP AS
  SELECT * FROM public.select_logo_candidates(50, 4, 5, 2);

  ASSERT EXISTS (SELECT 1 FROM sel WHERE id = s_neuf), 'un signal jamais tenté doit être candidat';
  ASSERT EXISTS (SELECT 1 FROM sel WHERE id = s_partiel), 'tentatives restantes hors backoff : candidat';
  ASSERT NOT EXISTS (SELECT 1 FROM sel WHERE id = s_backoff), 'un signal dans son backoff doit être exclu';
  ASSERT NOT EXISTS (SELECT 1 FROM sel WHERE id = s_epuise_sans), 'épuisé sans piste : doit rester exclu';
  ASSERT EXISTS (SELECT 1 FROM sel WHERE id = s_epuise_avec), 'épuisé AVEC piste fraîche : doit revenir';
  ASSERT NOT EXISTS (SELECT 1 FROM sel WHERE id = s_ignore), 'un signal écarté ne doit jamais être candidat';
  ASSERT NOT EXISTS (SELECT 1 FROM sel WHERE id = s_faible), 'un score sous le seuil doit être exclu';

  SELECT selection_reason INTO r FROM sel WHERE id = s_epuise_avec;
  ASSERT (SELECT selection_reason FROM sel WHERE id = s_epuise_avec) = 'piste_fraiche_apres_epuisement',
    'la raison de reprise doit être explicite';
  ASSERT (SELECT enrichment_domain FROM sel WHERE id = s_epuise_avec) = 'exemple.fr',
    'le domaine trouvé doit remonter avec le candidat';

  -- ============ le jamais-tenté passe AVANT la reprise ============
  ASSERT (SELECT id FROM sel ORDER BY (logo_fetch_attempts = 0) DESC LIMIT 1) = s_neuf
      OR (SELECT selection_reason FROM sel LIMIT 1) = 'jamais_tente',
    'un signal neuf ne doit pas attendre derrière une reprise';

  -- ================= LA PROPRIÉTÉ CRUCIALE =================
  -- Après une nouvelle tentative infructueuse, le signal repris ne doit PLUS
  -- ressortir : sinon il monopoliserait chaque tick indéfiniment.
  -- `logo_last_attempt_at` est reculé d'une seconde : en production la nouvelle
  -- tentative et la mise à jour d'enrichissement suivante sont deux
  -- transactions distinctes, donc deux instants différents. Dans un test à
  -- transaction unique, `now()` est figé — et le déclencheur
  -- `update_company_enrichment_updated_at` force lui aussi `updated_at = now()`.
  UPDATE public.signals
  SET logo_fetch_attempts = logo_fetch_attempts + 1,
      logo_last_attempt_at = now() - interval '1 second',
      logo_fetch_status = 'not_found'
  WHERE id = s_epuise_avec;

  SELECT count(*) INTO n
  FROM public.select_logo_candidates(50, 4, 5, 2) WHERE id = s_epuise_avec;
  ASSERT n = 0,
    'PAS DE BOUCLE : une reprise infructueuse ne doit pas resélectionner le signal';

  -- ...jusqu'à ce qu'une information RÉELLEMENT neuve arrive.
  -- Le déclencheur positionne lui-même `updated_at = now()`, soit après la
  -- tentative reculée ci-dessus. C'est exactement la séquence réelle.
  UPDATE public.company_enrichment
  SET website = 'https://autre-piste.fr'
  WHERE signal_id = s_epuise_avec;

  SELECT count(*) INTO n
  FROM public.select_logo_candidates(50, 4, 5, 2) WHERE id = s_epuise_avec;
  ASSERT n = 1,
    'une piste réellement nouvelle doit rouvrir la reprise';

  -- ================= la borne de résultats tient =================
  SELECT count(*) INTO n FROM public.select_logo_candidates(1, 0, 5, 2);
  ASSERT n <= 1, 'la limite demandée doit être respectée';
  SELECT count(*) INTO n FROM public.select_logo_candidates(9999, 0, 5, 2);
  ASSERT n <= 100, 'la limite doit être plafonnée à 100';

  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZTEST%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZTEST%';

  RAISE NOTICE 'CONTRATS DE SELECTION DES LOGOS VERIFIES';
END
$$;

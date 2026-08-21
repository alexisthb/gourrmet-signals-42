-- Contrats de l'autorisation de re-enrichissement (20260821200000).
--
-- L'enjeu : `enqueue_enrichment_job_authorized` est le garde-fou
-- anti-double-dépense. Cette fonction est la SEULE porte qui le franchit, et
-- elle doit rester étroite : un motif écrit, un job terminé, une trace. Si ces
-- assertions tombent, la porte s'est élargie — c'est-à-dire que la plateforme
-- peut re-payer un fournisseur sans que personne l'ait décidé.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  s_abouti uuid; s_en_vol uuid; s_echoue uuid;
  j_abouti uuid; j_en_vol uuid; j_nouveau uuid;
  res jsonb; n integer; motif text;
BEGIN
  motif := 'Personas elargis le 2026-08-21 : seconde passe decidee par l operateur';

  DELETE FROM public.enrichment_jobs
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZREGEN%');
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZREGEN%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZREGEN%';

  -- ============ un signal réellement abouti : le cas visé ============
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZREGEN abouti', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_abouti;
  INSERT INTO public.company_enrichment (signal_id, company_name, status)
  VALUES (s_abouti, 'ZZREGEN abouti', 'completed');
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, finished_at, result)
  VALUES (s_abouti, 'contacts', 'completed', now() - interval '2 days',
          jsonb_build_object('contacts_found', 3))
  RETURNING id INTO j_abouti;

  -- Le garde-fou tient AVANT autorisation : c'est la situation vécue le
  -- 2026-08-21 sur les 19 signaux du lundi.
  res := public.enqueue_enrichment_job_authorized(s_abouti, 'contacts', 10, 0, true);
  ASSERT res->>'state' = 'already_completed',
    'sans autorisation, un signal abouti doit rester bloque (obtenu: ' || (res->>'state') || ')';

  -- ---------------- un motif vide ou trop court est refusé ----------------
  BEGIN
    res := public.authorize_enrichment_regeneration(s_abouti, 'refais', 'test');
    ASSERT false, 'un motif de moins de 10 caracteres doit lever une exception';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    res := public.authorize_enrichment_regeneration(s_abouti, NULL, 'test');
    ASSERT false, 'un motif absent doit lever une exception';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  SELECT count(*) INTO n FROM public.enrichment_regeneration_authorizations
   WHERE signal_id = s_abouti;
  ASSERT n = 0, 'un refus ne doit laisser AUCUNE trace d autorisation';
  ASSERT (SELECT status FROM public.enrichment_jobs WHERE id = j_abouti) = 'completed',
    'un refus ne doit pas toucher au job precedent';

  -- ------------------------- le chemin nominal -------------------------
  res := public.authorize_enrichment_regeneration(s_abouti, motif, 'claude-code');
  ASSERT res->>'state' = 'authorized',
    'un signal abouti avec motif doit etre autorise (obtenu: ' || (res->>'state') || ')';
  ASSERT res->'enqueue'->>'state' = 'enqueued',
    'l autorisation doit reellement remettre un job en file (obtenu: '
      || (res->'enqueue'->>'state') || ')';
  ASSERT (res->>'superseded_job_id')::uuid = j_abouti,
    'le job supplante doit etre nomme dans le resultat';

  -- La trace : motif, auteur, job supplanté, consommation.
  SELECT count(*) INTO n FROM public.enrichment_regeneration_authorizations
   WHERE signal_id = s_abouti
     AND reason = motif
     AND authorized_by = 'claude-code'
     AND superseded_job_id = j_abouti
     AND consumed_at IS NOT NULL;
  ASSERT n = 1, 'l autorisation doit etre consignee integralement (motif, auteur, job, consommation)';

  -- Le job précédent est supplanté SANS être effacé : son résultat métier
  -- reste lisible, augmenté de la raison de sa mise à l'écart.
  ASSERT (SELECT status FROM public.enrichment_jobs WHERE id = j_abouti) = 'cancelled',
    'le job precedent doit passer en cancelled';
  ASSERT (SELECT result->>'contacts_found' FROM public.enrichment_jobs WHERE id = j_abouti) = '3',
    'le resultat metier du job precedent ne doit PAS etre efface';
  ASSERT (SELECT result->>'superseded_reason' FROM public.enrichment_jobs WHERE id = j_abouti) = motif,
    'le motif doit rester lisible sur le job supplante';
  ASSERT (SELECT lease_token FROM public.enrichment_jobs WHERE id = j_abouti) IS NULL,
    'un job supplante ne doit conserver aucun bail';

  -- Exactement UN job repart, en attente.
  SELECT count(*) INTO n FROM public.enrichment_jobs
   WHERE signal_id = s_abouti AND status IN ('pending', 'running');
  ASSERT n = 1, 'l autorisation doit produire exactement un job actif, pas deux';
  SELECT id INTO j_nouveau FROM public.enrichment_jobs
   WHERE signal_id = s_abouti AND status = 'pending';

  -- ============ LA PROPRIÉTÉ CRUCIALE : une autorisation = une passe ============
  -- Rejouer l'autorisation ne doit pas empiler un second job fournisseur.
  res := public.authorize_enrichment_regeneration(s_abouti, motif, 'claude-code');
  ASSERT res->>'state' = 'refused' AND res->>'reason' = 'job_en_vol',
    'une seconde autorisation pendant que le job tourne doit etre REFUSEE (obtenu: '
      || (res->>'state') || ')';
  SELECT count(*) INTO n FROM public.enrichment_jobs
   WHERE signal_id = s_abouti AND status IN ('pending', 'running');
  ASSERT n = 1, 'un refus ne doit pas avoir cree de second job';
  SELECT count(*) INTO n FROM public.enrichment_regeneration_authorizations
   WHERE signal_id = s_abouti;
  ASSERT n = 1, 'un refus ne doit pas consigner une autorisation supplementaire';

  -- ================= un job en vol est protégé, toujours =================
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZREGEN en vol', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_en_vol;
  -- Un job `running` doit porter son bail : la contrainte
  -- `enrichment_jobs_lease_state_check` l'exige, et c'est bien ce qui rend un
  -- job « en vol » identifiable.
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at)
  VALUES (s_en_vol, 'contacts', 'running', now(),
          'test', gen_random_uuid(), now() + interval '10 minutes')
  RETURNING id INTO j_en_vol;

  res := public.authorize_enrichment_regeneration(s_en_vol, motif, 'claude-code');
  ASSERT res->>'state' = 'refused' AND res->>'reason' = 'job_en_vol',
    'un enrichissement en cours ne doit jamais etre double';
  ASSERT (SELECT status FROM public.enrichment_jobs WHERE id = j_en_vol) = 'running',
    'un job en vol ne doit pas etre annule par une demande de regeneration';

  -- ============ un signal en échec passe aussi, et reste tracé ============
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZREGEN echoue', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_echoue;
  INSERT INTO public.company_enrichment (signal_id, company_name, status)
  VALUES (s_echoue, 'ZZREGEN echoue', 'failed');
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, finished_at)
  VALUES (s_echoue, 'contacts', 'failed', now() - interval '3 days');

  res := public.authorize_enrichment_regeneration(s_echoue, motif, 'claude-code');
  ASSERT res->>'state' = 'authorized' AND res->'enqueue'->>'state' = 'enqueued',
    'un signal en echec doit aussi pouvoir etre rejoue sur decision humaine';
  ASSERT (SELECT status FROM public.company_enrichment WHERE signal_id = s_echoue) = 'pending',
    'la fiche d enrichissement doit repasser en pending';

  -- =============== la porte reste fermée aux non-internes ===============
  SET LOCAL request.jwt.claim.role = 'anon';
  BEGIN
    res := public.authorize_enrichment_regeneration(s_en_vol, motif, 'inconnu');
    ASSERT false, 'un appelant non interne ne doit pas pouvoir autoriser une depense';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  SET LOCAL request.jwt.claim.role = 'service_role';

  DELETE FROM public.enrichment_regeneration_authorizations
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZREGEN%');
  DELETE FROM public.enrichment_jobs
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZREGEN%');
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZREGEN%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZREGEN%';

  RAISE NOTICE 'CONTRATS DE RE-ENRICHISSEMENT AUTORISE VERIFIES';
END
$$;

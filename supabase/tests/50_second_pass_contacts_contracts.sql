-- Contrats de la seconde passe d'enrichissement (20260821210000).
--
-- Ce que ces assertions protègent concrètement : l'écran que l'opératrice
-- ouvre lundi matin. Si elles tombent, soit elle voit la même personne deux
-- fois (dont une avec un lien mort), soit un rejeu payant n'a rien réparé.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  s_id uuid; e_id uuid; j_id uuid; tok uuid := gen_random_uuid();
  res jsonb; n integer; url text;
BEGIN
  DELETE FROM public.contacts WHERE full_name LIKE 'ZZPASS%';
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZPASS%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZPASS%';

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZPASS societe', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_id;
  INSERT INTO public.company_enrichment (signal_id, company_name, status)
  VALUES (s_id, 'ZZPASS societe', 'processing') RETURNING id INTO e_id;

  -- ===================== première passe : ancien monde =====================
  -- L'extracteur d'alors produisait des identifiants internes LinkedIn.
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes')
  RETURNING id INTO j_id;

  res := public.complete_enrichment_dispatch(j_id, tok, e_id, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('full_name','ZZPASS Marie Durand','first_name','ZZPASS Marie',
      'last_name','Durand','job_title','Office Manager',
      'linkedin_url','https://www.linkedin.com/in/ACwAABcDeFgHiJkLmNoPqRsTuVwXyZ01'),
    jsonb_build_object('full_name','ZZPASS Paul Martin','first_name','ZZPASS Paul',
      'last_name','Martin','job_title','Assistant de direction',
      'linkedin_url','https://www.linkedin.com/in/paul-martin-1234',
      'email_principal','paul.martin@zzpass.fr')
  ));
  ASSERT (res->>'contacts_inserted')::int = 2,
    'la premiere passe doit inserer les deux contacts (obtenu: ' || (res->>'contacts_inserted') || ')';

  -- ============ seconde passe : extracteur corrigé + personas élargis ============
  -- Marie revient avec son VRAI profil, un email, et un titre plus précis.
  -- Paul revient à l'identique. Et un décideur apparaît, que l'ancien ciblage
  -- ne cherchait pas.
  UPDATE public.enrichment_jobs SET status='completed', finished_at=now(),
         lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=j_id;
  tok := gen_random_uuid();
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes')
  RETURNING id INTO j_id;

  res := public.complete_enrichment_dispatch(j_id, tok, e_id, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('full_name','ZZPASS Marie Durand','first_name','ZZPASS Marie',
      'last_name','Durand','job_title','Directrice des Ressources Humaines',
      'linkedin_url','https://www.linkedin.com/in/marie-durand-rh',
      'email_principal','marie.durand@zzpass.fr','is_priority_target',true),
    jsonb_build_object('full_name','ZZPASS Paul Martin','first_name','ZZPASS Paul',
      'last_name','Martin','job_title','Assistant de direction',
      'linkedin_url','https://www.linkedin.com/in/paul-martin-1234',
      'email_principal','autre.adresse@zzpass.fr'),
    jsonb_build_object('full_name','ZZPASS Sophie Bernard','first_name','ZZPASS Sophie',
      'last_name','Bernard','job_title','Directrice Générale',
      'linkedin_url','https://www.linkedin.com/in/sophie-bernard-dg')
  ));

  -- ================= LA PROPRIÉTÉ CRUCIALE : pas de doublon =================
  SELECT count(*) INTO n FROM public.contacts WHERE enrichment_id = e_id;
  ASSERT n = 3,
    'PAS DE DOUBLON : trois personnes distinctes, pas cinq (obtenu: ' || n || ')';
  SELECT count(*) INTO n FROM public.contacts
   WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand';
  ASSERT n = 1,
    'une URL LinkedIn qui change de format ne doit PAS creer une seconde fiche';
  ASSERT (res->>'contacts_inserted')::int = 1,
    'seule la personne reellement nouvelle doit etre inseree (obtenu: '
      || (res->>'contacts_inserted') || ')';
  ASSERT (res->>'contacts_repaired')::int >= 2,
    'les fiches connues doivent etre comptees comme reparees';

  -- ===================== la réparation a bien eu lieu =====================
  SELECT linkedin_url INTO url FROM public.contacts
   WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand';
  ASSERT url = 'https://www.linkedin.com/in/marie-durand-rh',
    'le lien mort doit etre remplace par le vrai profil (obtenu: ' || coalesce(url,'NULL') || ')';
  ASSERT (SELECT email_principal FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand')
         = 'marie.durand@zzpass.fr',
    'un email jusque-la inconnu doit etre renseigne';
  ASSERT (SELECT is_priority_target FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand') = true,
    'la priorite doit suivre les personas COURANTS : c est l objet de l elargissement';

  -- ============ mais rien d'exploitable n'est écrasé ============
  ASSERT (SELECT email_principal FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZPASS Paul Martin')
         = 'paul.martin@zzpass.fr',
    'un email deja connu ne doit JAMAIS etre remplace par celui du fournisseur';
  ASSERT (SELECT job_title FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand')
         = 'Office Manager',
    'un intitule de poste deja renseigne ne doit pas etre ecrase';

  -- ============ un vrai profil ne doit jamais reculer vers un opaque ============
  UPDATE public.enrichment_jobs SET status='completed', finished_at=now(),
         lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL WHERE id=j_id;
  tok := gen_random_uuid();
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes')
  RETURNING id INTO j_id;
  res := public.complete_enrichment_dispatch(j_id, tok, e_id, '{}'::jsonb, jsonb_build_array(
    jsonb_build_object('full_name','ZZPASS Marie Durand','first_name','ZZPASS Marie',
      'last_name','Durand',
      'linkedin_url','https://www.linkedin.com/in/ACwAAZZZZZZZZZZZZZZZZZZZZZZZZ')
  ));
  ASSERT (SELECT linkedin_url FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZPASS Marie Durand')
         = 'https://www.linkedin.com/in/marie-durand-rh',
    'une passe ulterieure ne doit pas REGRESSER un vrai profil en identifiant interne';
  SELECT count(*) INTO n FROM public.contacts WHERE enrichment_id = e_id;
  ASSERT n = 3, 'une troisieme passe ne doit rien ajouter non plus (obtenu: ' || n || ')';

  -- ================= la reconnaissance de l'opaque =================
  ASSERT public.is_opaque_linkedin_url('https://www.linkedin.com/in/ACwAABcDeFgHiJkLmNoPqRs') = true,
    'un identifiant interne doit etre reconnu comme opaque';
  ASSERT public.is_opaque_linkedin_url('https://www.linkedin.com/in/marie-durand-rh') = false,
    'un nom public ne doit pas etre pris pour un identifiant interne';
  ASSERT public.is_opaque_linkedin_url(NULL) = false,
    'une URL absente n est pas une URL opaque';
  -- Un vrai nom peut commencer par « ac » sans etre un identifiant interne.
  ASSERT public.is_opaque_linkedin_url('https://www.linkedin.com/in/acme-consulting') = false,
    'un slug court commencant par ac ne doit pas etre confondu avec un URN';

  DELETE FROM public.contacts WHERE enrichment_id = e_id;
  DELETE FROM public.enrichment_jobs WHERE signal_id = s_id;
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZPASS%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZPASS%';

  RAISE NOTICE 'CONTRATS DE SECONDE PASSE VERIFIES';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA MÊME PROPRIÉTÉ SUR LA VOIE LINKEDIN — celle qui tourne réellement.
--
-- La réparation avait d'abord été posée sur `complete_enrichment_dispatch`
-- seulement. Or la production finalise par `finalize_linkedin_enrichment_poll`,
-- qui portait sa propre copie du dédoublonnage. Deux copies du même
-- raisonnement, une seule corrigée : le correctif ne servait à rien.
-- Ce bloc vérifie que les DEUX voies se comportent pareil.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  s_id uuid; e_id uuid; j_id uuid;
  tok uuid := gen_random_uuid(); poll uuid := gen_random_uuid();
  res jsonb; n integer;
BEGIN
  DELETE FROM public.contacts WHERE full_name LIKE 'ZZLKIN%';
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZLKIN%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZLKIN%';

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZLKIN societe', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_id;
  INSERT INTO public.company_enrichment (signal_id, company_name, status)
  VALUES (s_id, 'ZZLKIN societe', 'linkedin_processing') RETURNING id INTO e_id;
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at,
                                      poll_token, poll_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes',
          poll, now() + interval '10 minutes')
  RETURNING id INTO j_id;

  -- Première passe : identifiant interne, aucun email.
  res := public.finalize_linkedin_enrichment_poll(
    j_id, tok, poll, e_id, s_id, 'completed', now(), 'completed', 1, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'full_name','ZZLKIN Claire Petit','first_name','ZZLKIN Claire','last_name','Petit',
      'job_title','Office Manager',
      'linkedin_url','https://www.linkedin.com/in/ACwAABcDeFgHiJkLmNoPqRsTuVwXyZ99')),
    '{}'::jsonb, NULL);
  ASSERT (res->>'contacts_inserted')::int = 1,
    'voie LinkedIn : la premiere passe doit inserer le contact';

  -- Seconde passe : vrai profil, email vérifié, et un décideur en plus.
  tok := gen_random_uuid(); poll := gen_random_uuid();
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at,
                                      poll_token, poll_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes',
          poll, now() + interval '10 minutes')
  RETURNING id INTO j_id;
  res := public.finalize_linkedin_enrichment_poll(
    j_id, tok, poll, e_id, s_id, 'completed', now(), 'completed', 2, '{}'::jsonb,
    jsonb_build_array(
      jsonb_build_object(
        'full_name','ZZLKIN Claire Petit','first_name','ZZLKIN Claire','last_name','Petit',
        'job_title','Office Manager',
        'linkedin_url','https://www.linkedin.com/in/claire-petit-om',
        'email_principal','claire.petit@zzlkin.fr',
        'email_verification_status','verified'),
      jsonb_build_object(
        'full_name','ZZLKIN Hugo Roy','first_name','ZZLKIN Hugo','last_name','Roy',
        'job_title','Directeur Général',
        'linkedin_url','https://www.linkedin.com/in/hugo-roy-dg')),
    '{}'::jsonb, NULL);

  SELECT count(*) INTO n FROM public.contacts WHERE enrichment_id = e_id;
  ASSERT n = 2,
    'voie LinkedIn : PAS DE DOUBLON quand l URL passe de l identifiant interne au nom public (obtenu: '
      || n || ')';
  ASSERT (res->>'contacts_inserted')::int = 1,
    'voie LinkedIn : seul le decideur nouveau doit etre insere';
  ASSERT (SELECT linkedin_url FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZLKIN Claire Petit')
         = 'https://www.linkedin.com/in/claire-petit-om',
    'voie LinkedIn : le lien mort doit etre remplace par le vrai profil';
  ASSERT (SELECT email_verification_status FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZLKIN Claire Petit') = 'verified',
    'une verification d email reellement aboutie doit remplacer l absence de verification';

  -- Un échec ne doit jamais toucher aux contacts déjà acquis : c'est ce qui
  -- garantit qu'un rejeu infructueux ne vide pas l'écran de l'opératrice.
  tok := gen_random_uuid(); poll := gen_random_uuid();
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at,
                                      poll_token, poll_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes',
          poll, now() + interval '10 minutes')
  RETURNING id INTO j_id;
  res := public.finalize_linkedin_enrichment_poll(
    j_id, tok, poll, e_id, s_id, 'failed', now(), 'completed', 0, '{}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, 'Aucun profil opérationnel résolu (0 profils examinés).');
  SELECT count(*) INTO n FROM public.contacts WHERE enrichment_id = e_id;
  ASSERT n = 2,
    'un rejeu infructueux ne doit RIEN retirer a la fiche existante (obtenu: ' || n || ')';

  -- ═══ UNE RÉPARATION IMPOSSIBLE NE DOIT PAS COÛTER LA FICHE ENTIÈRE ═══
  -- Mesuré en production sur VECTOR FRANCE : l'index
  -- `contacts_signal_linkedin_unique` interdit deux fois la même URL sur un
  -- signal. Quand la même personne figure deux fois — une ligne ancienne avec
  -- son nom public, une récente avec l'identifiant interne — réparer la
  -- seconde réclamait l'URL de la première. La contrainte refusait, la
  -- fonction levait, et le poller perdait TOUT l'enrichissement.
  INSERT INTO public.contacts (enrichment_id, signal_id, full_name, first_name,
                               last_name, job_title, linkedin_url, outreach_status)
  VALUES (e_id, s_id, 'ZZLKIN Ancien Doublon', 'ZZLKIN Ancien', 'Doublon',
          'Directeur', 'https://www.linkedin.com/in/doublon-public', 'new');
  tok := gen_random_uuid(); poll := gen_random_uuid();
  INSERT INTO public.enrichment_jobs (signal_id, job_type, status, started_at,
                                      lease_owner, lease_token, lease_expires_at,
                                      poll_token, poll_expires_at)
  VALUES (s_id, 'contacts', 'running', now(), 'test', tok, now() + interval '10 minutes',
          poll, now() + interval '10 minutes')
  RETURNING id INTO j_id;

  -- Claire revient avec l'URL que « Ancien Doublon » détient déjà.
  res := public.finalize_linkedin_enrichment_poll(
    j_id, tok, poll, e_id, s_id, 'completed', now(), 'completed', 1, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'full_name','ZZLKIN Claire Petit','first_name','ZZLKIN Claire','last_name','Petit',
      'job_title','Office Manager',
      'linkedin_url','https://www.linkedin.com/in/doublon-public')),
    '{}'::jsonb, NULL);

  ASSERT res->>'accepted' = 'true',
    'une reparation impossible ne doit PAS faire echouer la finalisation';
  ASSERT (SELECT linkedin_url FROM public.contacts
           WHERE enrichment_id = e_id AND full_name = 'ZZLKIN Claire Petit')
         = 'https://www.linkedin.com/in/claire-petit-om',
    'Claire garde son URL : celle demandee appartient deja a un autre contact';
  SELECT count(*) INTO n FROM public.contacts WHERE signal_id = s_id
   AND linkedin_url = 'https://www.linkedin.com/in/doublon-public';
  ASSERT n = 1, 'l URL ne doit exister qu une seule fois sur le signal';

  DELETE FROM public.contacts WHERE signal_id = s_id;
  DELETE FROM public.enrichment_jobs WHERE signal_id = s_id;
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZLKIN%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZLKIN%';

  RAISE NOTICE 'CONTRATS DE SECONDE PASSE (VOIE LINKEDIN) VERIFIES';
END
$$;

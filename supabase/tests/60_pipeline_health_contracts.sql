-- Contrats de la détection « tuyau vide » (20260822020000).
--
-- Ce que ces assertions protègent : la capacité à voir qu'une chaîne ne produit
-- plus. Deux fois en trois jours, la plateforme a tourné en affichant du vert
-- alors qu'elle ne produisait rien — 17 heures de panne 401, puis un filtre de
-- titres qui vidait les datasets Apify. Si ces assertions tombent, on est
-- retourné à la vigilance humaine, c'est-à-dire à rien.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  v_verdict text; v_resume text;
BEGIN
  DELETE FROM public.scan_logs WHERE status = 'ZZHEALTH';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZHEALTH%';

  -- ═══ LE CAS DES DIX-SEPT HEURES : ça tourne, ça ne produit rien ═══
  -- Un scan qui se termine « completed » avec zéro article : exactement ce que
  -- la panne du 2026-08-20 affichait pendant que six chaînes étaient mortes.
  INSERT INTO public.scan_logs (started_at, completed_at, status,
                                articles_fetched, articles_analyzed, signals_created)
  VALUES (now() - interval '2 hours', now() - interval '2 hours', 'completed', 0, 0, 0);

  SELECT verdict INTO v_verdict FROM public.pipeline_health WHERE chaine = 'presse';
  ASSERT v_verdict LIKE 'TUYAU VIDE%',
    'un scan qui tourne sans produire doit etre signale TUYAU VIDE (obtenu: '
      || coalesce(v_verdict, 'NULL') || ')';

  SELECT public.pipeline_health_summary() INTO v_resume;
  ASSERT v_resume LIKE 'ALERTE%' AND v_resume LIKE '%presse%',
    'le resume d une ligne doit nommer la chaine en cause (obtenu: ' || coalesce(v_resume,'NULL') || ')';

  -- ═══ Une chaîne qui produit ne doit PAS alarmer ═══
  INSERT INTO public.scan_logs (started_at, completed_at, status,
                                articles_fetched, articles_analyzed, signals_created)
  VALUES (now() - interval '1 hour', now() - interval '1 hour', 'completed', 232, 232, 1);

  SELECT verdict INTO v_verdict FROM public.pipeline_health WHERE chaine = 'presse';
  ASSERT v_verdict = 'OK',
    'une chaine qui produit ne doit pas alarmer (obtenu: ' || coalesce(v_verdict,'NULL') || ')';

  -- ═══ Distinguer « muette » de « vide » : elles ne se soignent pas pareil ═══
  -- Aucun signal touché depuis 24h -> la chaîne logos n'a pas tourné du tout.
  -- Ce n'est pas un rendement nul, c'est une absence.
  SELECT verdict INTO v_verdict FROM public.pipeline_health WHERE chaine = 'logos';
  ASSERT v_verdict IS NOT NULL, 'chaque chaine doit apparaitre, meme sans activite';

  -- ═══ LE RENDEMENT, PAS L'ACTIVITÉ ═══
  -- 20 tentatives de logo, une seule aboutie : 5 %. La chaîne « tourne »
  -- parfaitement et ne sert quasiment à rien — c'est ce que le tableau de bord
  -- d'avant appelait un succès.
  FOR i IN 1..19 LOOP
    INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                                logo_last_attempt_at, logo_fetch_attempts)
    VALUES ('ZZHEALTH rate ' || i, 'anniversaire', 5, 'new', now(), now() - interval '1 hour', 1);
  END LOOP;
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at,
                              logo_last_attempt_at, logo_fetch_attempts, company_logo_url)
  VALUES ('ZZHEALTH reussi', 'anniversaire', 5, 'new', now(), now() - interval '1 hour', 1,
          'https://exemple.test/logo.png');

  SELECT verdict INTO v_verdict FROM public.pipeline_health WHERE chaine = 'logos';
  ASSERT v_verdict LIKE 'RENDEMENT FAIBLE%',
    '20 tentatives pour 1 resultat doit etre signale comme rendement faible (obtenu: '
      || coalesce(v_verdict,'NULL') || ')';

  -- ═══ Le résumé HIÉRARCHISE : le plus grave passe devant ═══
  -- L'opérateur pressé doit lire d'abord ce qui saigne. Un tuyau vide prime sur
  -- un rendement faible, qui prime sur « OK » — sinon le résumé noierait
  -- l'incident dans la moyenne, ce qui est exactement ce qu'a fait le tableau
  -- de bord pendant les dix-sept heures.
  SELECT public.pipeline_health_summary() INTO v_resume;
  ASSERT v_resume LIKE 'ALERTE%',
    'un tuyau vide coexistant avec un rendement faible doit rendre ALERTE, pas VIGILANCE (obtenu: '
      || coalesce(v_resume,'NULL') || ')';
  ASSERT v_resume NOT LIKE '%RENDEMENT%' AND v_resume NOT LIKE 'OK%',
    'le resume ne doit pas diluer une alerte dans les chaines saines';
  -- Et la chaîne au rendement faible reste visible dans la vue détaillée :
  -- le résumé priorise, il n'efface pas.
  ASSERT (SELECT count(*) FROM public.pipeline_health
           WHERE verdict LIKE 'RENDEMENT FAIBLE%') >= 1,
    'la vue detaillee doit conserver la chaine au rendement faible';

  DELETE FROM public.signals WHERE company_name LIKE 'ZZHEALTH%';
  DELETE FROM public.scan_logs
   WHERE started_at > now() - interval '3 hours' AND status = 'completed';

  RAISE NOTICE 'CONTRATS DE DETECTION DU TUYAU VIDE VERIFIES';
END
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- LA RÉSERVATION DE QUOTA APIFY, APPELÉE POUR DE VRAI.
--
-- Le banc APPLIQUAIT les migrations sans jamais APPELER les fonctions. Une
-- migration du 22/08 a ainsi passé au vert alors que son INSERT nommait une
-- colonne inexistante, omettait deux colonnes NOT NULL et posait un
-- `dispatch_state` que l'étape suivante refuse — elle aurait cassé TOUT
-- l'enrichissement LinkedIn en production.
--
-- C'est le même aveuglement que le tableau de bord vert : vérifier que l'ordre
-- a été donné, jamais qu'il produit quelque chose.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  s_id uuid; e_id uuid; res jsonb; ok boolean; n integer;
BEGIN
  DELETE FROM public.provider_quota_reservations WHERE request_key LIKE 'ZZQUOTA%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZQUOTA%';

  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZQUOTA societe', 'anniversaire', 5, 'new', now()) RETURNING id INTO s_id;
  e_id := gen_random_uuid();

  -- Le plan doit exister et être en période courante, sinon la réservation lève.
  INSERT INTO public.apify_plan_settings (quota_unit, monthly_run_limit,
                                          current_period_start, current_period_end)
  VALUES ('actor_runs', 1000, current_date - 1, current_date + 30)
  ON CONFLICT DO NOTHING;
  UPDATE public.apify_plan_settings
  SET quota_unit='actor_runs', monthly_run_limit=1000,
      current_period_start=current_date - 1, current_period_end=current_date + 30;

  -- ═══ LES TROIS OPÉRATIONS FACTURÉES SONT ACCEPTÉES ═══
  FOREACH res IN ARRAY ARRAY['"linkedin_company_search"'::jsonb,
                             '"linkedin_employee_submit"'::jsonb,
                             '"linkedin_profile_full"'::jsonb]
  LOOP
    DECLARE op text := res #>> '{}'; r jsonb;
    BEGIN
      r := public.reserve_apify_actor_run(
        'ZZQUOTA:' || op, op, e_id, s_id, jsonb_build_object('source','contrat'));
      ASSERT r->>'allowed' = 'true',
        'l operation ' || op || ' doit etre reservable (obtenu: ' || r::text || ')';
    END;
  END LOOP;

  -- Le second étage, précisément : c'est lui qui était hors quota.
  SELECT count(*) INTO n FROM public.provider_quota_reservations
   WHERE request_key = 'ZZQUOTA:linkedin_profile_full';
  ASSERT n = 1, 'le second etage doit consommer une reservation reelle';

  -- ═══ L'ÉTAT POSÉ DOIT ÊTRE CELUI QUE L'ÉTAPE SUIVANTE ATTEND ═══
  -- C'est exactement la faute qui est passée : `reserved` au lieu de `prepared`
  -- aurait rendu `mark_dispatched` faux à vie, sans aucune erreur visible.
  ASSERT (SELECT metadata->>'dispatch_state' FROM public.provider_quota_reservations
           WHERE request_key = 'ZZQUOTA:linkedin_profile_full') = 'prepared',
    'la reservation doit poser dispatch_state=prepared, seule valeur acceptee ensuite';
  ASSERT (SELECT reserved_units FROM public.provider_quota_reservations
           WHERE request_key = 'ZZQUOTA:linkedin_profile_full') = 1,
    'reserved_units est NOT NULL avec CHECK > 0 : il doit etre renseigne';
  ASSERT (SELECT expires_at FROM public.provider_quota_reservations
           WHERE request_key = 'ZZQUOTA:linkedin_profile_full') > now(),
    'expires_at doit etre dans le futur, sinon mark_dispatched refuse';
  ASSERT (SELECT metadata->>'signal_id' FROM public.provider_quota_reservations
           WHERE request_key = 'ZZQUOTA:linkedin_profile_full') = s_id::text,
    'le signal_id doit rester dans le metadata : complete_apify_actor_run le relit';

  -- ═══ LA CHAÎNE COMPLÈTE : réserver -> dispatcher -> finaliser ═══
  ok := public.mark_apify_actor_run_dispatched('ZZQUOTA:linkedin_profile_full');
  ASSERT ok = true, 'l intention durable avant POST doit etre acceptee';
  PERFORM public.complete_apify_actor_run(
    'ZZQUOTA:linkedin_profile_full', true, NULL, 200, NULL, 4,
    jsonb_build_object('source','contrat'));

  -- ═══ ANTI-DOUBLE-DÉPENSE : la même clé ne réserve pas deux fois ═══
  res := public.reserve_apify_actor_run(
    'ZZQUOTA:linkedin_profile_full', 'linkedin_profile_full', e_id, s_id, '{}'::jsonb);
  ASSERT res->>'allowed' = 'false' AND res->>'reason' = 'existing_reservation',
    'une seconde reservation sur la meme cle doit etre REFUSEE (obtenu: ' || res::text || ')';

  -- ═══ Une opération inconnue reste refusée ═══
  BEGIN
    res := public.reserve_apify_actor_run('ZZQUOTA:inconnu', 'operation_inventee', e_id, s_id, '{}'::jsonb);
    ASSERT false, 'une operation hors liste blanche doit lever';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;

  DELETE FROM public.provider_quota_reservations WHERE request_key LIKE 'ZZQUOTA%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZQUOTA%';

  RAISE NOTICE 'CONTRATS DE RESERVATION DE QUOTA APIFY VERIFIES';
END
$$;

-- Tests fonctionnels de la machine tonale 1795 sur PostgreSQL réel.
-- Chaque contrat correspond à l'un des quatre défauts listés dans le handoff.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  r jsonb; run_id uuid; tok uuid; ok boolean; st text; att integer;
  fb uuid[]; f1 uuid; f2 uuid; f3 uuid; f4 uuid; f5 uuid; f6 uuid;
  key text := 'tonal_charter:' || repeat('a', 40);
BEGIN
  -- socle
  DELETE FROM public.tonal_charter_analysis_runs;
  DELETE FROM public.message_feedback;
  DELETE FROM public.provider_usage_events WHERE provider = 'lovable_ai';
  IF NOT EXISTS (SELECT 1 FROM public.tonal_charter) THEN
    INSERT INTO public.tonal_charter (charter_data) VALUES ('{}'::jsonb);
  END IF;
  UPDATE public.tonal_charter SET last_analysis_at = NULL, corrections_count = 0;

  INSERT INTO public.message_feedback (message_type, original_message, edited_message)
  VALUES ('email','a','b') RETURNING id INTO f1;
  INSERT INTO public.message_feedback (message_type, original_message, edited_message)
  VALUES ('email','a','b') RETURNING id INTO f2;
  fb := ARRAY[f1, f2];

  -- ============ DÉFAUT 1 : la claim RÉSERVE, elle ne dispatche pas ==========
  r := public.claim_tonal_charter_analysis(key, 'm1', fb, 2, 300);
  ASSERT r->>'state' = 'reserved',
    'claim doit créer un état reserved, obtenu: ' || (r->>'state');
  ASSERT (r->>'should_dispatch')::boolean,
    'une réservation neuve doit autoriser le dispatch';
  run_id := (r->>'run_id')::uuid; tok := (r->>'lease_token')::uuid;

  -- une réservation vivante verrouille les concurrents
  r := public.claim_tonal_charter_analysis(key, 'm1', fb, 2, 300);
  ASSERT r->>'state' = 'active', 'une réservation vivante doit bloquer un second appelant';

  -- expiration d'une RÉSERVATION = rejouable (aucune intention durable)
  UPDATE public.tonal_charter_analysis_runs
  SET lease_expires_at = now() - interval '1 minute' WHERE id = run_id;
  r := public.claim_tonal_charter_analysis(key, 'm1', fb, 2, 300);
  ASSERT r->>'state' = 'reserved',
    'une réservation expirée doit être REPRISE, obtenu: ' || (r->>'state');
  ASSERT (r->>'attempt')::int = 2,
    'la reprise doit incrémenter la tentative pour changer de clé fournisseur';
  tok := (r->>'lease_token')::uuid;

  -- sceau fencé : mauvais jeton refusé
  ok := public.begin_tonal_charter_dispatch(run_id, gen_random_uuid(), 'k', 300);
  ASSERT NOT ok, 'un sceau avec un jeton étranger doit être refusé';

  -- sceau légitime : reserved -> dispatching
  ok := public.begin_tonal_charter_dispatch(run_id, tok, 'lovable_ai:update_tonal_charter:x:2', 300);
  ASSERT ok, 'le sceau légitime doit passer';
  SELECT status INTO st FROM public.tonal_charter_analysis_runs WHERE id = run_id;
  ASSERT st = 'dispatching', 'après sceau, état attendu dispatching, obtenu: ' || st;

  -- expiration d'un DISPATCH = ambiguë, jamais rejouée
  UPDATE public.tonal_charter_analysis_runs
  SET lease_expires_at = now() - interval '1 minute' WHERE id = run_id;
  r := public.claim_tonal_charter_analysis(key, 'm1', fb, 2, 300);
  ASSERT r->>'state' = 'reconciliation_required',
    'un dispatch expiré doit exiger une réconciliation, obtenu: ' || (r->>'state');

  -- ============ DÉFAUT 2 : pas de charte sans dépense prouvée =============
  DELETE FROM public.tonal_charter_analysis_runs;
  r := public.claim_tonal_charter_analysis(key, 'm1', fb, 2, 300);
  run_id := (r->>'run_id')::uuid; tok := (r->>'lease_token')::uuid;
  PERFORM public.begin_tonal_charter_dispatch(run_id, tok, 'req-key-1', 300);
  PERFORM public.cache_tonal_charter_analysis_response(
    run_id, tok, 'req-key-1', '{"http_status":200}'::jsonb, 300);

  -- ledger encore unconfirmed -> refus explicite
  INSERT INTO public.provider_usage_events
    (provider, operation, request_key, units, requests_count, items_count,
     success, dispatch_status)
  VALUES ('lovable_ai','update_tonal_charter','req-key-1',0,0,2,false,'unconfirmed');
  r := public.complete_tonal_charter_analysis(run_id, tok, '{"summary":"x"}'::jsonb, 2, 0.5);
  ASSERT (r->>'applied')::boolean IS FALSE, 'la charte ne doit pas s appliquer sans dépense confirmée';
  ASSERT r->>'reason' = 'ledger_unconfirmed', 'raison attendue ledger_unconfirmed, obtenu: ' || (r->>'reason');

  -- ledger confirmé -> application
  UPDATE public.provider_usage_events
  SET dispatch_status = 'confirmed', requests_count = 1, units = 50
  WHERE request_key = 'req-key-1';
  r := public.complete_tonal_charter_analysis(run_id, tok, '{"summary":"x"}'::jsonb, 2, 0.5);
  ASSERT (r->>'applied')::boolean, 'la charte doit s appliquer une fois la dépense confirmée';
  SELECT status INTO st FROM public.tonal_charter_analysis_runs WHERE id = run_id;
  ASSERT st = 'completed', 'run attendu completed, obtenu: ' || st;

  -- ============ DÉFAUT 4 : seuil monotone, pas de modulo ==================
  -- Le run `completed` ci-dessus porte la cohorte {f1, f2} : ces deux
  -- feedbacks sont analysés, donc ils ne comptent plus comme en attente.
  r := public.sync_tonal_charter_feedback_state(5);
  ASSERT (r->>'pending_since_last_analysis')::int = 0,
    'les feedbacks de la dernière cohorte ne sont plus en attente';
  ASSERT (r->>'should_update_charter')::boolean IS FALSE, 'cohorte analysée -> aucun déclenchement';

  INSERT INTO public.message_feedback (message_type, original_message, edited_message)
  SELECT 'email','a','b' FROM generate_series(1,4);
  r := public.sync_tonal_charter_feedback_state(5);
  ASSERT (r->>'should_update_charter')::boolean IS FALSE, '4 nouveaux feedbacks -> pas encore';
  ASSERT (r->>'pending_since_last_analysis')::int = 4, 'décompte des feedbacks hors cohorte faux';

  -- deux insertions concurrentes font passer 4 -> 6 : l ancien modulo sautait
  -- le seuil, le critère « au moins 5 nouveaux » ne le peut pas.
  INSERT INTO public.message_feedback (message_type, original_message, edited_message)
  SELECT 'email','a','b' FROM generate_series(1,2);
  r := public.sync_tonal_charter_feedback_state(5);
  ASSERT (r->>'should_update_charter')::boolean, '6 feedbacks hors cohorte doivent déclencher (le modulo sautait)';
  ASSERT (r->>'total_corrections')::int = 8, 'total_corrections faux';
  ASSERT (r->>'pending_since_last_analysis')::int = 6, 'pending hors cohorte faux';
  SELECT corrections_count INTO att FROM public.tonal_charter;
  ASSERT att = 8, 'le compteur de la charte doit être synchronisé';

  -- ============ DÉFAUT 3 : reset transactionnel et honnête ================
  DELETE FROM public.tonal_charter_analysis_runs;
  -- un run réservé (aucun coût possible) et un run dispatché (coût possible)
  r := public.claim_tonal_charter_analysis('tonal_charter:' || repeat('b',40), 'm1', fb, 2, 300);
  r := public.claim_tonal_charter_analysis('tonal_charter:' || repeat('c',40), 'm1', fb, 2, 300);
  run_id := (r->>'run_id')::uuid; tok := (r->>'lease_token')::uuid;
  PERFORM public.begin_tonal_charter_dispatch(run_id, tok, 'req-key-2', 300);

  r := public.reset_tonal_charter();
  ASSERT (r->>'deleted_feedbacks')::int = 8, 'le reset doit purger les feedbacks';
  ASSERT (r->>'abandoned_runs')::int = 1, 'le run réservé doit être abandonné';
  ASSERT (r->>'reconciliation_required_runs')::int = 1,
    'le run dispatché doit partir en réconciliation, jamais en abandon';
  ASSERT NOT EXISTS (SELECT 1 FROM public.message_feedback), 'feedbacks non purgés';
  SELECT corrections_count INTO att FROM public.tonal_charter;
  ASSERT att = 0, 'compteur non réinitialisé';
  ASSERT (SELECT last_analysis_at IS NULL FROM public.tonal_charter LIMIT 1),
    'last_analysis_at doit repartir à NULL';

  RAISE NOTICE 'TOUS LES CONTRATS TONAUX 1795 SONT VERIFIES';
END
$$;

-- Contrats du verrou anti-double-facturation des enrichissements.
--
-- Un échec local écrit après le dernier événement fournisseur confirmé clôt
-- la tentative et autorise un réessai. Un lot encore actif ou un dispatch
-- récent non confirmé reste bloqué.
\set ON_ERROR_STOP on
SET request.jwt.claim.role = 'service_role';

DO $$
DECLARE
  s_failed uuid; s_active uuid; s_uncertain uuid;
  e_failed uuid; e_active uuid; e_uncertain uuid;
  v_blocker text;
BEGIN
  DELETE FROM public.provider_usage_events
   WHERE signal_id IN (SELECT id FROM public.signals WHERE company_name LIKE 'ZZRETRYBLOCKER%');
  DELETE FROM public.provider_quota_reservations
   WHERE run_id IN (SELECT id FROM public.company_enrichment WHERE company_name LIKE 'ZZRETRYBLOCKER%');
  DELETE FROM public.pappers_credit_usage
   WHERE details->>'signal_id' IN (
     SELECT id::text FROM public.signals WHERE company_name LIKE 'ZZRETRYBLOCKER%'
   );
  DELETE FROM public.company_enrichment WHERE company_name LIKE 'ZZRETRYBLOCKER%';
  DELETE FROM public.signals WHERE company_name LIKE 'ZZRETRYBLOCKER%';

  -- Le cas observé : le fournisseur a répondu, puis la finalisation locale a
  -- échoué. Le failed_at est la preuve terminale la plus récente.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZRETRYBLOCKER failed terminal', 'anniversaire', 5, 'new', now())
  RETURNING id INTO s_failed;
  INSERT INTO public.company_enrichment (
    signal_id, company_name, status, raw_data, error_message
  ) VALUES (
    s_failed, 'ZZRETRYBLOCKER failed terminal', 'failed',
    jsonb_build_object(
      'dropcontact_request_id', 'dc-failed',
      'outcome', 'poller_exception',
      'failed_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'finalisation transactionnelle interrompue'
  ) RETURNING id INTO e_failed;
  INSERT INTO public.provider_usage_events (
    provider, operation, run_id, signal_id, request_key, success,
    dispatch_status, occurred_at, created_at, metadata
  ) VALUES (
    'dropcontact', 'enrich_poll', e_failed, s_failed, 'zz-retry-failed', true,
    'confirmed', now() - interval '1 minute', now() - interval '1 minute',
    jsonb_build_object('provider_request_id', 'dc-failed')
  );
  v_blocker := public.contact_enrichment_retry_blocker(s_failed);
  ASSERT v_blocker IS NULL,
    'un échec terminal postérieur au dernier événement confirmé doit être rejouable (obtenu: '
      || coalesce(v_blocker, 'NULL') || ')';

  -- Un lot encore en traitement garde sa protection.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZRETRYBLOCKER active', 'anniversaire', 5, 'new', now())
  RETURNING id INTO s_active;
  INSERT INTO public.company_enrichment (signal_id, company_name, status, raw_data)
  VALUES (
    s_active, 'ZZRETRYBLOCKER active', 'dropcontact_processing',
    jsonb_build_object('dropcontact_request_id', 'dc-active', 'outcome', 'dropcontact_pending')
  ) RETURNING id INTO e_active;
  v_blocker := public.contact_enrichment_retry_blocker(s_active);
  ASSERT v_blocker = 'dropcontact_task_nonterminal',
    'un lot Dropcontact actif doit rester bloqué (obtenu: ' || coalesce(v_blocker, 'NULL') || ')';

  -- Une finalisation locale ne couvre jamais une intention fournisseur dont
  -- le résultat n'a pas été confirmé.
  INSERT INTO public.signals (company_name, signal_type, score, status, detected_at)
  VALUES ('ZZRETRYBLOCKER uncertain', 'anniversaire', 5, 'new', now())
  RETURNING id INTO s_uncertain;
  INSERT INTO public.company_enrichment (signal_id, company_name, status, raw_data)
  VALUES (
    s_uncertain, 'ZZRETRYBLOCKER uncertain', 'failed',
    jsonb_build_object(
      'dropcontact_request_id', 'dc-uncertain',
      'outcome', 'poller_exception',
      'failed_at', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  ) RETURNING id INTO e_uncertain;
  INSERT INTO public.provider_usage_events (
    provider, operation, run_id, signal_id, request_key, success,
    dispatch_status, occurred_at, created_at, metadata
  ) VALUES (
    'dropcontact', 'enrich_submit', e_uncertain, s_uncertain, 'zz-retry-uncertain', false,
    'unconfirmed', now(), now(), jsonb_build_object('provider_request_id', 'dc-uncertain')
  );
  v_blocker := public.contact_enrichment_retry_blocker(s_uncertain);
  ASSERT v_blocker = 'provider_dispatch_unconfirmed',
    'un dispatch récent non confirmé doit rester bloqué (obtenu: '
      || coalesce(v_blocker, 'NULL') || ')';

  DELETE FROM public.provider_usage_events WHERE signal_id IN (s_failed, s_active, s_uncertain);
  DELETE FROM public.provider_quota_reservations WHERE run_id IN (e_failed, e_active, e_uncertain);
  DELETE FROM public.pappers_credit_usage
   WHERE details->>'signal_id' IN (s_failed::text, s_active::text, s_uncertain::text);
  DELETE FROM public.company_enrichment WHERE signal_id IN (s_failed, s_active, s_uncertain);
  DELETE FROM public.signals WHERE id IN (s_failed, s_active, s_uncertain);

  RAISE NOTICE 'CONTRATS DU VERROU DE REESSAI VERIFIES';
END
$$;
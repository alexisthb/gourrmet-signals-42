-- Real SQL contracts, isolated by the test harness and rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET request.jwt.claim.role = 'service_role';
INSERT INTO auth.users(id,email) VALUES('aa000000-0000-0000-0000-000000000085','followup-test@example.test');
INSERT INTO public.user_roles(user_id,role) VALUES('aa000000-0000-0000-0000-000000000085','user');
INSERT INTO public.signals(id,company_name,signal_type,score,status) VALUES
 ('bb000000-0000-0000-0000-000000000085','ZZFOLLOWUP contacted','anniversaire',5,'new'),
 ('bb000000-0000-0000-0000-000000000086','ZZFOLLOWUP preparation only','anniversaire',5,'new'),
 ('bb000000-0000-0000-0000-000000000087','ZZFOLLOWUP already worked','anniversaire',5,'won');
INSERT INTO public.contacts(id,signal_id,full_name,outreach_status) VALUES
 ('cc000000-0000-0000-0000-000000000085','bb000000-0000-0000-0000-000000000085','Contact confirmé','new'),
 ('cc000000-0000-0000-0000-000000000086','bb000000-0000-0000-0000-000000000086','Contact non envoyé','new'),
 ('cc000000-0000-0000-0000-000000000087','bb000000-0000-0000-0000-000000000087','Contact gagné','converted');
INSERT INTO public.contact_interactions(contact_id,action_type) VALUES
 ('cc000000-0000-0000-0000-000000000086','email_generated'),
 ('cc000000-0000-0000-0000-000000000086','linkedin_message_copied');
INSERT INTO public.emails_sent(id,signal_id,contact_id,recipient_email,sender_email,subject,body,status)
 VALUES('dd000000-0000-0000-0000-000000000085','bb000000-0000-0000-0000-000000000086','cc000000-0000-0000-0000-000000000086','test@example.test','sender@example.test','SQL test','Not actually sent','queued');
DO $$ BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.contacted_signals WHERE signal_id='bb000000-0000-0000-0000-000000000086'), 'generation, copy and queueing must not count as contact';
END $$;
SET request.jwt.claim.role = 'authenticated';
SET request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000085';
SET LOCAL ROLE authenticated;
SELECT public.confirm_signal_outreach('bb000000-0000-0000-0000-000000000085','cc000000-0000-0000-0000-000000000085','linkedin','zz-followup-confirmation');
SELECT public.confirm_signal_outreach('bb000000-0000-0000-0000-000000000085','cc000000-0000-0000-0000-000000000085','linkedin','zz-followup-confirmation');
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.signal_outreach_events WHERE signal_id='bb000000-0000-0000-0000-000000000085' AND channel='linkedin')=1, 'one confirmation, including a retry, means exactly one LinkedIn event';
 ASSERT (SELECT status FROM public.signals WHERE id='bb000000-0000-0000-0000-000000000085')='contacted', 'confirmed LinkedIn send marks signal contacted';
 ASSERT (SELECT outreach_status FROM public.contacts WHERE id='cc000000-0000-0000-0000-000000000085')='linkedin_sent', 'confirmed LinkedIn send marks contact sent';
 ASSERT (public.get_contacted_signals('ZZFOLLOWUP contacted','linkedin')->>'total_count')::int=1, 'internal non-admin sees confirmed signal';
 BEGIN
  PERFORM public.confirm_signal_outreach('bb000000-0000-0000-0000-000000000085','cc000000-0000-0000-0000-000000000086','email','zz-wrong-contact');
  RAISE EXCEPTION 'wrong-company contact was accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='wrong-company contact was accepted' THEN RAISE; END IF;
 END;
END $$;
-- Each of the six requested choices has its own write/read assertion.
DO $$ DECLARE choice text; BEGIN
 FOREACH choice IN ARRAY ARRAY['read','deleted_unread','not_interested','interested','sample_requested','order_in_progress'] LOOP
  INSERT INTO public.signal_contact_followups(signal_id,feedback) VALUES('bb000000-0000-0000-0000-000000000085',choice)
  ON CONFLICT(signal_id) DO UPDATE SET feedback=EXCLUDED.feedback;
  ASSERT (SELECT feedback FROM public.signal_contact_followups WHERE signal_id='bb000000-0000-0000-0000-000000000085')=choice, 'feedback readback: '||choice;
  ASSERT (public.get_contacted_signals('ZZFOLLOWUP contacted','all',choice)->>'total_count')::int=1, 'feedback filter: '||choice;
 END LOOP;
 ASSERT (SELECT count(*) FROM public.signal_interactions WHERE signal_id='bb000000-0000-0000-0000-000000000085' AND action_type='company_feedback')=6, 'upsert records exactly one history row per actual change';
 BEGIN
  UPDATE public.signal_contact_followups SET feedback='invalid' WHERE signal_id='bb000000-0000-0000-0000-000000000085';
  RAISE EXCEPTION 'invalid feedback accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT public.confirm_signal_outreach('bb000000-0000-0000-0000-000000000087','cc000000-0000-0000-0000-000000000087','email','zz-worked-contact');
DO $$ BEGIN
 ASSERT (SELECT status FROM public.signals WHERE id='bb000000-0000-0000-0000-000000000087')='won', 'send must preserve worked signal status';
 ASSERT (SELECT outreach_status FROM public.contacts WHERE id='cc000000-0000-0000-0000-000000000087')='converted', 'send must preserve worked contact status';
END $$;
RESET ROLE;
SET request.jwt.claim.role = 'service_role';
UPDATE public.emails_sent SET status='sent',provider_message_id='zz-provider-accepted',sent_at='2026-10-20T10:00:00Z'
 WHERE id='dd000000-0000-0000-0000-000000000085';
DO $$ BEGIN
 ASSERT (SELECT count(*) FROM public.signal_outreach_events WHERE signal_id='bb000000-0000-0000-0000-000000000086' AND channel='email')=1, 'accepted app email creates exactly one email event';
 ASSERT (SELECT status FROM public.signals WHERE id='bb000000-0000-0000-0000-000000000086')='contacted', 'app email automatically marks signal contacted';
 ASSERT (SELECT outreach_status FROM public.contacts WHERE id='cc000000-0000-0000-0000-000000000086')='email_sent', 'app email automatically marks contact sent';
END $$;
UPDATE public.emails_sent SET status='delivered' WHERE id='dd000000-0000-0000-0000-000000000085';
SET request.jwt.claim.role = 'authenticated';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 ASSERT (public.get_contacted_signals('ZZFOLLOWUP preparation only','email','all','2026-10-19T22:00:00Z','2026-10-20T22:00:00Z')->>'total_count')::int=1, 'date filter includes actual email send within Paris date';
 ASSERT (public.get_contacted_signals('ZZFOLLOWUP preparation only','email','all','2026-10-20T10:00:01Z',NULL)->>'total_count')::int=0, 'date filter excludes earlier send';
 ASSERT (SELECT count(*) FROM public.signal_outreach_events WHERE signal_id='bb000000-0000-0000-0000-000000000086' AND channel='email')=1, 'delivery update does not duplicate accepted email';
END $$;
SET request.jwt.claim.sub = 'aa000000-0000-0000-0000-000000000099';
DO $$ BEGIN
 ASSERT (public.get_contacted_signals('ZZFOLLOWUP')->>'total_count')::int=0, 'unauthorized authenticated account sees no contacted signals';
 BEGIN
  INSERT INTO public.signal_contact_followups(signal_id,feedback) VALUES('bb000000-0000-0000-0000-000000000086','read');
  RAISE EXCEPTION 'unauthorized feedback write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 ASSERT NOT has_table_privilege('anon','public.signal_contact_followups','SELECT'), 'anonymous feedback read forbidden';
 ASSERT NOT has_function_privilege('anon','public.get_contacted_signals(text,text,text,timestamptz,timestamptz,integer,integer)','EXECUTE'), 'anonymous contacted query forbidden';
END $$;
ROLLBACK;
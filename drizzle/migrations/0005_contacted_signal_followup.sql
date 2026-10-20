CREATE TABLE IF NOT EXISTS public.signal_outreach_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), signal_id uuid NOT NULL REFERENCES public.signals(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL, event_key text NOT NULL UNIQUE,
 channel text NOT NULL CHECK(channel IN ('email','linkedin','unknown')), contacted_at timestamptz,
 recipient text, evidence text NOT NULL, delivery_status text, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.signal_outreach_events TO authenticated;
GRANT ALL ON public.signal_outreach_events TO service_role;
ALTER TABLE public.signal_outreach_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY outreach_read ON public.signal_outreach_events FOR SELECT TO authenticated USING(public.is_internal_user());
CREATE POLICY outreach_insert ON public.signal_outreach_events FOR INSERT TO authenticated WITH CHECK(public.is_internal_user());
CREATE INDEX signal_outreach_signal_date_idx ON public.signal_outreach_events(signal_id,contacted_at DESC);
CREATE INDEX signal_outreach_date_idx ON public.signal_outreach_events(contacted_at DESC,signal_id);
CREATE TABLE IF NOT EXISTS public.signal_contact_followups (
 signal_id uuid PRIMARY KEY REFERENCES public.signals(id) ON DELETE CASCADE,
 feedback text CHECK(feedback IN ('read','deleted_unread','not_interested','interested','sample_requested','order_in_progress')),
 updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
GRANT SELECT, INSERT, UPDATE ON public.signal_contact_followups TO authenticated;
GRANT ALL ON public.signal_contact_followups TO service_role;
ALTER TABLE public.signal_contact_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY followups_read ON public.signal_contact_followups FOR SELECT TO authenticated USING(public.is_internal_user());
CREATE POLICY followups_insert ON public.signal_contact_followups FOR INSERT TO authenticated WITH CHECK(public.is_internal_user() AND EXISTS(SELECT 1 FROM public.signal_outreach_events e WHERE e.signal_id=signal_contact_followups.signal_id));
CREATE POLICY followups_update ON public.signal_contact_followups FOR UPDATE TO authenticated USING(public.is_internal_user()) WITH CHECK(public.is_internal_user());
CREATE OR REPLACE FUNCTION public.record_contact_outreach_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE sid uuid; ch text;
BEGIN
 IF NEW.action_type='email_sent' OR (NEW.action_type='status_change' AND NEW.new_value='email_sent') THEN ch:='email';
 ELSIF NEW.action_type='linkedin_sent' OR (NEW.action_type='status_change' AND NEW.new_value='linkedin_sent') THEN ch:='linkedin';
 ELSE RETURN NEW; END IF;
 SELECT signal_id INTO sid FROM public.contacts WHERE id=NEW.contact_id;
 IF sid IS NOT NULL THEN
 INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence)
 VALUES(sid,NEW.contact_id,'interaction:'||NEW.id,ch,NEW.created_at,NEW.metadata->>'recipient','confirmed_contact_interaction') ON CONFLICT(event_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_contact_outreach_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER contact_outreach_interaction AFTER INSERT ON public.contact_interactions FOR EACH ROW EXECUTE FUNCTION public.record_contact_outreach_event();
CREATE OR REPLACE FUNCTION public.record_email_outreach_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE cid uuid; sid uuid;
BEGIN
 IF NEW.status NOT IN ('sent','delivered','bounced','complained','replied') OR NEW.provider_message_id IS NULL OR btrim(NEW.provider_message_id)='' OR NEW.sent_at IS NULL OR NEW.kpi_eligible IS NOT TRUE THEN RETURN NEW; END IF;
 sid:=NEW.signal_id;
 IF NEW.contact_id IS NOT NULL THEN
 SELECT id,coalesce(sid,signal_id) INTO cid,sid FROM public.contacts WHERE id=NEW.contact_id AND (sid IS NULL OR signal_id=sid);
 IF NOT FOUND THEN sid:=NEW.signal_id; cid:=NULL; END IF;
 END IF;
 IF sid IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence,delivery_status)
 VALUES(sid,cid,'email:'||NEW.id,'email',NEW.sent_at,NEW.recipient_email,'provider_accepted',NEW.status)
 ON CONFLICT(event_key) DO UPDATE SET delivery_status=EXCLUDED.delivery_status;
 IF NEW.status IN ('sent','delivered','replied') THEN
 UPDATE public.signals SET status=CASE WHEN status='new' THEN 'contacted' ELSE status END,contacted_at=coalesce(contacted_at,NEW.sent_at),pipeline_status=CASE WHEN pipeline_status IN ('detected','enriched','drafted','ready') THEN 'sent' ELSE pipeline_status END WHERE id=sid;
 UPDATE public.contacts SET outreach_status='email_sent' WHERE id=cid AND outreach_status='new';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_email_outreach_event() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER email_outreach_event AFTER INSERT OR UPDATE ON public.emails_sent FOR EACH ROW EXECUTE FUNCTION public.record_email_outreach_event();
CREATE OR REPLACE FUNCTION public.record_signal_contact_date() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NEW.contacted_at IS NOT NULL AND NEW.status IN ('contacted','meeting','proposal','won','lost') THEN
 IF TG_OP='INSERT' OR OLD.contacted_at IS DISTINCT FROM NEW.contacted_at THEN
 INSERT INTO public.signal_outreach_events(signal_id,event_key,channel,contacted_at,evidence)
 VALUES(NEW.id,'signal-date:'||NEW.id||':'||NEW.contacted_at,'unknown',NEW.contacted_at,'manual_signal_status') ON CONFLICT(event_key) DO NOTHING;
 END IF; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_signal_contact_date() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER signal_outreach_date AFTER INSERT OR UPDATE OF contacted_at ON public.signals FOR EACH ROW EXECUTE FUNCTION public.record_signal_contact_date();
INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence)
SELECT c.signal_id,c.id,'interaction:'||i.id,CASE WHEN i.action_type='email_sent' OR i.new_value='email_sent' THEN 'email' ELSE 'linkedin' END,i.created_at,i.metadata->>'recipient','confirmed_contact_interaction'
FROM public.contact_interactions i JOIN public.contacts c ON c.id=i.contact_id
WHERE i.action_type IN ('email_sent','linkedin_sent') OR (i.action_type='status_change' AND i.new_value IN ('email_sent','linkedin_sent')) ON CONFLICT(event_key) DO NOTHING;
INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence,delivery_status)
SELECT coalesce(e.signal_id,c.signal_id),c.id,'email:'||e.id,'email',e.sent_at,e.recipient_email,'provider_accepted',e.status
FROM public.emails_sent e LEFT JOIN public.contacts c ON c.id=e.contact_id AND (e.signal_id IS NULL OR c.signal_id=e.signal_id)
WHERE coalesce(e.signal_id,c.signal_id) IS NOT NULL AND e.status IN ('sent','delivered','bounced','complained','replied') AND e.sent_at IS NOT NULL AND e.provider_message_id IS NOT NULL AND btrim(e.provider_message_id)<>'' AND e.kpi_eligible ON CONFLICT(event_key) DO NOTHING;
INSERT INTO public.signal_outreach_events(signal_id,event_key,channel,contacted_at,evidence)
SELECT id,'signal-date:'||id||':'||contacted_at,'unknown',contacted_at,'manual_signal_status' FROM public.signals WHERE contacted_at IS NOT NULL AND status IN ('contacted','meeting','proposal','won','lost') ON CONFLICT(event_key) DO NOTHING;
INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,evidence)
SELECT c.signal_id,c.id,'legacy-contact:'||c.id,CASE c.outreach_status WHEN 'email_sent' THEN 'email' WHEN 'linkedin_sent' THEN 'linkedin' ELSE 'unknown' END,'legacy_contact_status_date_unknown'
FROM public.contacts c WHERE c.outreach_status IN ('email_sent','linkedin_sent','responded','meeting','converted','not_interested') AND NOT EXISTS(SELECT 1 FROM public.signal_outreach_events e WHERE e.contact_id=c.id) ON CONFLICT(event_key) DO NOTHING;
INSERT INTO public.signal_outreach_events(signal_id,event_key,channel,evidence)
SELECT s.id,'legacy-signal:'||s.id,'unknown','legacy_signal_status_date_unknown' FROM public.signals s WHERE s.status IN ('contacted','meeting','proposal','won','lost') AND NOT EXISTS(SELECT 1 FROM public.signal_outreach_events e WHERE e.signal_id=s.id) ON CONFLICT(event_key) DO NOTHING;
CREATE OR REPLACE FUNCTION public.audit_signal_contact_feedback() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.signal_outreach_events WHERE signal_id=NEW.signal_id) THEN RAISE EXCEPTION 'Ce signal n’a pas encore été contacté'; END IF;
 NEW.updated_at:=now(); NEW.updated_by:=auth.uid();
 IF TG_OP='INSERT' OR OLD.feedback IS DISTINCT FROM NEW.feedback THEN
 INSERT INTO public.signal_interactions(signal_id,action_type,old_value,new_value) VALUES(NEW.signal_id,'company_feedback',CASE WHEN TG_OP='UPDATE' THEN OLD.feedback END,NEW.feedback);
 END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_signal_contact_feedback() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_signal_contact_feedback BEFORE INSERT OR UPDATE ON public.signal_contact_followups FOR EACH ROW EXECUTE FUNCTION public.audit_signal_contact_feedback();
CREATE OR REPLACE VIEW public.contacted_signals WITH(security_invoker=true) AS
SELECT s.id AS signal_id,s.company_name,s.signal_type,s.source_name,s.status,s.event_detail,min(e.contacted_at) AS first_contacted_at,max(e.contacted_at) AS last_contacted_at,
 array_remove(array_agg(DISTINCT e.channel),CASE WHEN bool_or(e.channel<>'unknown') THEN 'unknown' END) AS channels,f.feedback,f.updated_at AS feedback_updated_at,
 coalesce(jsonb_agg(DISTINCT jsonb_build_object('id',c.id,'name',c.full_name,'job_title',c.job_title)) FILTER(WHERE c.id IS NOT NULL),'[]'::jsonb) AS contacted_contacts,
 coalesce(array_agg(DISTINCT e.recipient) FILTER(WHERE e.recipient IS NOT NULL),'{}'::text[]) AS email_recipients,bool_or(e.delivery_status='bounced') AS has_bounced_email
FROM public.signals s JOIN public.signal_outreach_events e ON e.signal_id=s.id LEFT JOIN public.contacts c ON c.id=e.contact_id AND c.signal_id=s.id LEFT JOIN public.signal_contact_followups f ON f.signal_id=s.id GROUP BY s.id,f.feedback,f.updated_at;
GRANT SELECT ON public.contacted_signals TO authenticated,service_role;
REVOKE ALL ON public.contacted_signals FROM anon;
CREATE OR REPLACE FUNCTION public.get_contacted_signals(p_search text DEFAULT '',p_channel text DEFAULT 'all',p_feedback text DEFAULT 'all',p_from timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_page integer DEFAULT 1,p_page_size integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
WITH filtered AS(
 SELECT v.* FROM public.contacted_signals v WHERE(p_search='' OR v.company_name ILIKE '%'||p_search||'%' OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.contacted_contacts) c WHERE c->>'name' ILIKE '%'||p_search||'%'))
 AND(p_feedback='all' OR(p_feedback='pending' AND v.feedback IS NULL) OR v.feedback=p_feedback)
 AND EXISTS(SELECT 1 FROM public.signal_outreach_events e WHERE e.signal_id=v.signal_id AND(p_channel='all' OR e.channel=p_channel) AND(p_from IS NULL OR e.contacted_at>=p_from) AND(p_until IS NULL OR e.contacted_at<p_until))
),page AS(SELECT * FROM filtered ORDER BY last_contacted_at DESC NULLS LAST,signal_id DESC LIMIT greatest(1,least(p_page_size,50)) OFFSET(greatest(p_page,1)-1)*greatest(1,least(p_page_size,50)))
SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(page)) FROM page),'[]'::jsonb),'total_count',(SELECT count(*) FROM filtered));
$$;
REVOKE ALL ON FUNCTION public.get_contacted_signals(text,text,text,timestamptz,timestamptz,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_contacted_signals(text,text,text,timestamptz,timestamptz,integer,integer) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.confirm_signal_outreach(p_signal_id uuid,p_contact_id uuid,p_channel text,p_event_key text,p_recipient text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT public.is_internal_user() OR p_channel NOT IN ('email','linkedin') THEN RAISE EXCEPTION 'Confirmation non autorisée'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.signals WHERE id=p_signal_id) THEN RAISE EXCEPTION 'Signal introuvable'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact_id AND signal_id=p_signal_id) THEN RAISE EXCEPTION 'Ce contact n’appartient pas à ce signal'; END IF;
 INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence) VALUES(p_signal_id,p_contact_id,'manual:'||p_event_key,p_channel,now(),p_recipient,'manual_send_confirmation') ON CONFLICT(event_key) DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.contacts SET outreach_status=p_channel||'_sent' WHERE id=p_contact_id AND outreach_status IN ('new','email_sent','linkedin_sent');
 INSERT INTO public.contact_interactions(contact_id,action_type,new_value,metadata) SELECT p_contact_id,p_channel||'_sent',NULL,jsonb_build_object('signal_id',p_signal_id,'recipient',p_recipient) WHERE p_contact_id IS NOT NULL;
 UPDATE public.signals SET status=CASE WHEN status='new' THEN 'contacted' ELSE status END,contacted_at=coalesce(contacted_at,now()),pipeline_status=CASE WHEN pipeline_status IN ('detected','enriched','drafted','ready') THEN 'sent' ELSE pipeline_status END,pipeline_updated_at=now() WHERE id=p_signal_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_signal_outreach(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_signal_outreach(uuid,uuid,text,text,text) TO authenticated;
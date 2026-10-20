CREATE OR REPLACE FUNCTION public.record_contact_outreach_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE sid uuid; ch text;
BEGIN
 IF NEW.metadata ? 'outreach_event_key' OR NEW.metadata ? 'email_id' THEN RETURN NEW; END IF;
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
CREATE OR REPLACE FUNCTION public.audit_signal_contact_feedback() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.signal_outreach_events WHERE signal_id=NEW.signal_id) THEN RAISE EXCEPTION 'Ce signal n’a pas encore été contacté'; END IF;
 NEW.updated_at:=now(); NEW.updated_by:=auth.uid();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_signal_contact_feedback() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.record_signal_contact_feedback() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' OR OLD.feedback IS DISTINCT FROM NEW.feedback THEN
 INSERT INTO public.signal_interactions(signal_id,action_type,old_value,new_value) VALUES(NEW.signal_id,'company_feedback',CASE WHEN TG_OP='UPDATE' THEN OLD.feedback END,NEW.feedback);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.record_signal_contact_feedback() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS record_signal_contact_feedback ON public.signal_contact_followups;
CREATE TRIGGER record_signal_contact_feedback AFTER INSERT OR UPDATE ON public.signal_contact_followups FOR EACH ROW EXECUTE FUNCTION public.record_signal_contact_feedback();
CREATE OR REPLACE FUNCTION public.confirm_signal_outreach(p_signal_id uuid DEFAULT NULL,p_contact_id uuid DEFAULT NULL,p_channel text DEFAULT NULL,p_event_key text DEFAULT NULL,p_recipient text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_catalog AS $$
BEGIN
 IF NOT public.is_internal_user() OR p_channel IS NULL OR p_channel NOT IN ('email','linkedin') OR p_event_key IS NULL OR btrim(p_event_key)='' THEN RAISE EXCEPTION 'Confirmation non autorisée'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.signals WHERE id=p_signal_id) THEN RAISE EXCEPTION 'Signal introuvable'; END IF;
 IF p_contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact_id AND signal_id=p_signal_id) THEN RAISE EXCEPTION 'Ce contact n’appartient pas à ce signal'; END IF;
 INSERT INTO public.signal_outreach_events(signal_id,contact_id,event_key,channel,contacted_at,recipient,evidence) VALUES(p_signal_id,p_contact_id,'manual:'||p_event_key,p_channel,now(),p_recipient,'manual_send_confirmation') ON CONFLICT(event_key) DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.contacts SET outreach_status=p_channel||'_sent' WHERE id=p_contact_id AND outreach_status IN ('new','email_sent','linkedin_sent');
 INSERT INTO public.contact_interactions(contact_id,action_type,new_value,metadata) SELECT p_contact_id,p_channel||'_sent',NULL,jsonb_build_object('signal_id',p_signal_id,'recipient',p_recipient,'outreach_event_key','manual:'||p_event_key) WHERE p_contact_id IS NOT NULL;
 UPDATE public.signals SET status=CASE WHEN status='new' THEN 'contacted' ELSE status END,contacted_at=coalesce(contacted_at,now()),pipeline_status=CASE WHEN pipeline_status IN ('detected','enriched','drafted','ready') THEN 'sent' ELSE pipeline_status END,pipeline_updated_at=now() WHERE id=p_signal_id;
END $$;
REVOKE ALL ON FUNCTION public.confirm_signal_outreach(uuid,uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_signal_outreach(uuid,uuid,text,text,text) TO authenticated;
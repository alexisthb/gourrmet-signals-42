REVOKE ALL ON public.signal_outreach_events FROM PUBLIC,anon;
REVOKE ALL ON public.signal_contact_followups FROM PUBLIC,anon;
REVOKE ALL ON public.contacted_signals FROM PUBLIC,anon;
GRANT SELECT,INSERT ON public.signal_outreach_events TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.signal_contact_followups TO authenticated;
GRANT SELECT ON public.contacted_signals TO authenticated,service_role;
GRANT ALL ON public.signal_outreach_events,public.signal_contact_followups TO service_role;
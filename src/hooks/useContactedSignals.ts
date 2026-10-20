import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { contactedPageSchema, contactDateBounds, type CompanyFeedback } from '@/lib/contacted-signals';

export function useContactedSignals(filters: { search: string; channel: string; feedback: string; from: string; to: string; page: number }) {
  return useQuery({
    queryKey: ['contacted-signals', filters],
    queryFn: async () => {
      const dates = contactDateBounds(filters.from, filters.to);
      const { data, error } = await supabase.rpc('get_contacted_signals', {
        p_search: filters.search, p_channel: filters.channel, p_feedback: filters.feedback,
        p_from: dates.from ?? undefined, p_until: dates.until ?? undefined, p_page: filters.page, p_page_size: 25,
      });
      if (error) throw error;
      return contactedPageSchema.parse(data);
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}
export function useSaveCompanyFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ signalId, feedback }: { signalId: string; feedback: CompanyFeedback | null }) => {
      const { error } = await supabase.from('signal_contact_followups').upsert({ signal_id: signalId, feedback });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      client.invalidateQueries({ queryKey: ['contacted-signals'] });
      client.invalidateQueries({ queryKey: ['signal-interactions', variables.signalId] });
      client.invalidateQueries({ queryKey: ['intervened-signals'] });
    },
  });
}
export function useConfirmSignalOutreach() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (params: { signalId: string; contactId?: string; channel: 'email' | 'linkedin'; eventKey: string; recipient?: string }) => {
      const { error } = await supabase.rpc('confirm_signal_outreach', {
        p_signal_id: params.signalId, p_contact_id: params.contactId ?? undefined,
        p_channel: params.channel, p_event_key: params.eventKey, p_recipient: params.recipient,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ['contacted-signals','signals','signal','signal-enrichment','all-contacts','contact-stats','contact-interactions','intervened-contacts']) {
        client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
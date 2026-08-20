import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { collectAllPages } from '@/lib/supabasePagination';

export interface ContactWithSignal {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  location: string | null;
  email_principal: string | null;
  email_alternatif: string | null;
  linkedin_url: string | null;
  is_priority_target: boolean;
  priority_score: number;
  outreach_status: string;
  notes: string | null;
  created_at: string;
  signal_id: string;
  next_action_at: string | null;
  next_action_note: string | null;
  signal: {
    company_name: string;
    signal_type: string;
    sector: string | null;
    event_detail: string | null;
    source_name: string | null;
  } | null;
}

export function useAllContacts(filters?: {
  status?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ['all-contacts', filters],
    queryFn: async () => {
      return collectAllPages<ContactWithSignal>((from, to) => {
        let query = (supabase
          .from('contacts') as any)
          .select(`
            *,
            signal:signals(company_name, signal_type, sector, event_detail, source_name)
          `)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);

        if (filters?.status && filters.status !== 'all') {
          query = query.eq('outreach_status', filters.status);
        }
        if (filters?.search) {
          query = query.or(`full_name.ilike.%${filters.search}%,email_principal.ilike.%${filters.search}%,job_title.ilike.%${filters.search}%`);
        }
        return query;
      });
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}

export function useUpdateContactNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, notes }: { contactId: string; notes: string }) => {
      const { error } = await (supabase
        .from('contacts') as any)
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('id', contactId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
    },
  });
}

export function useContactStats() {
  return useQuery({
    queryKey: ['contact-stats'],
    queryFn: async () => {
      const count = async (status?: string) => {
        let query = (supabase.from('contacts') as any).select('id', { count: 'exact', head: true });
        if (status) query = query.eq('outreach_status', status);
        const { count: value, error } = await query;
        if (error) throw error;
        return value || 0;
      };
      const [total, fresh, linkedinSent, emailSent, responded, meeting, converted, notInterested] = await Promise.all([
        count(), count('new'), count('linkedin_sent'), count('email_sent'),
        count('responded'), count('meeting'), count('converted'), count('not_interested'),
      ]);
      const stats = {
        total,
        new: fresh,
        linkedin_sent: linkedinSent,
        email_sent: emailSent,
        responded,
        meeting,
        converted,
        not_interested: notInterested,
      };

      return stats;
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}

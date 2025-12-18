import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

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
  signal: {
    company_name: string;
    signal_type: string;
    sector: string | null;
    event_detail: string | null;
  } | null;
}

export function useAllContacts(filters?: {
  status?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ['all-contacts', filters],
    queryFn: async () => {
      let query = supabase
        .from('contacts')
        .select(`
          *,
          signal:signals(company_name, signal_type, sector, event_detail)
        `)
        .order('created_at', { ascending: false });

      if (filters?.status && filters.status !== 'all') {
        query = query.eq('outreach_status', filters.status);
      }

      if (filters?.search) {
        query = query.or(`full_name.ilike.%${filters.search}%,email_principal.ilike.%${filters.search}%,job_title.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as ContactWithSignal[];
    },
  });
}

export function useUpdateContactNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, notes }: { contactId: string; notes: string }) => {
      const { error } = await supabase
        .from('contacts')
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
      const { data, error } = await supabase
        .from('contacts')
        .select('outreach_status');

      if (error) throw error;

      const stats = {
        total: data.length,
        new: data.filter(c => c.outreach_status === 'new').length,
        linkedin_sent: data.filter(c => c.outreach_status === 'linkedin_sent').length,
        email_sent: data.filter(c => c.outreach_status === 'email_sent').length,
        responded: data.filter(c => c.outreach_status === 'responded').length,
        meeting: data.filter(c => c.outreach_status === 'meeting').length,
        converted: data.filter(c => c.outreach_status === 'converted').length,
        not_interested: data.filter(c => c.outreach_status === 'not_interested').length,
      };

      return stats;
    },
  });
}

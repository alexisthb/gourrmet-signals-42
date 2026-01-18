import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tables } from '@/integrations/supabase/types';

export type EventContact = Tables<'event_contacts'>;

export interface EventContactWithEvent extends EventContact {
  event?: {
    id: string;
    name: string;
    type: string;
    date_start: string;
  };
}

// Hook pour récupérer tous les contacts événementiels avec leur événement source
export function useAllEventContacts() {
  return useQuery({
    queryKey: ['all-event-contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_contacts')
        .select(`
          *,
          event:events!event_contacts_event_id_fkey(id, name, type, date_start)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as EventContactWithEvent[];
    },
  });
}

// Hook pour mettre à jour le statut d'un contact événementiel
export function useUpdateEventContact() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<EventContact> & { id: string }) => {
      const { data, error } = await supabase
        .from('event_contacts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['all-event-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['event-contacts', data.event_id] });
      toast.success('Contact mis à jour');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Stats des contacts événementiels
export function useEventContactsStats() {
  const { data: contacts } = useAllEventContacts();
  
  const total = contacts?.length ?? 0;
  const contacted = contacts?.filter(c => 
    ['contacted', 'met_at_event', 'demo_scheduled', 'follow_up_sent', 'proposal_sent', 'converted'].includes(c.outreach_status || '')
  ).length ?? 0;
  const withEmail = contacts?.filter(c => c.email).length ?? 0;
  const withLinkedIn = contacts?.filter(c => c.linkedin_url).length ?? 0;
  const converted = contacts?.filter(c => c.outreach_status === 'converted').length ?? 0;
  
  // Group by event
  const byEvent = contacts?.reduce((acc, c) => {
    const eventId = c.event_id;
    if (!acc[eventId]) {
      acc[eventId] = { count: 0, eventName: (c.event as any)?.name || 'Événement inconnu' };
    }
    acc[eventId].count++;
    return acc;
  }, {} as Record<string, { count: number; eventName: string }>) ?? {};

  return {
    total,
    contacted,
    withEmail,
    withLinkedIn,
    converted,
    byEvent,
  };
}

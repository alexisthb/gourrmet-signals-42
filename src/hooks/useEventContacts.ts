import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Tables } from '@/integrations/supabase/types';

export type EventContact = Tables<'event_contacts'>;
export type SalonExposant = Tables<'salon_mariage_exposants'>;

export interface EventContactWithEvent extends EventContact {
  event?: {
    id: string;
    name: string;
    type: string;
    date_start: string;
  };
  source_table?: 'event_contacts' | 'salon_mariage';
}

// Unified contact type for the centralized view
export interface UnifiedEventContact {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  notes: string | null;
  outreach_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  event_id: string;
  event?: {
    id: string;
    name: string;
    type: string;
    date_start: string;
  };
  source_table: 'event_contacts' | 'salon_mariage';
  // Extra fields from salon_mariage
  tier?: number | null;
  specialties?: string[] | null;
  is_priority?: boolean | null;
}

// Hook pour récupérer tous les contacts événementiels avec leur événement source
// Inclut les contacts de event_contacts ET les exposants du salon du mariage
export function useAllEventContacts() {
  return useQuery({
    queryKey: ['all-event-contacts-unified'],
    queryFn: async () => {
      // Fetch event_contacts
      const { data: eventContacts, error: eventError } = await supabase
        .from('event_contacts')
        .select(`
          *,
          event:events!event_contacts_event_id_fkey(id, name, type, date_start)
        `)
        .order('created_at', { ascending: false });
      
      if (eventError) throw eventError;

      // Fetch salon_mariage_exposants
      const { data: salonExposants, error: salonError } = await supabase
        .from('salon_mariage_exposants')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (salonError) throw salonError;

      // Find the Salon du Mariage event
      const { data: salonEvent } = await supabase
        .from('events')
        .select('id, name, type, date_start')
        .ilike('name', '%mariage%')
        .single();

      // Transform event_contacts to unified format
      const unifiedEventContacts: UnifiedEventContact[] = (eventContacts || []).map(c => ({
        id: c.id,
        full_name: c.full_name,
        first_name: c.first_name,
        last_name: c.last_name,
        job_title: c.job_title,
        company_name: c.company_name,
        email: c.email,
        phone: c.phone,
        linkedin_url: c.linkedin_url,
        notes: c.notes,
        outreach_status: c.outreach_status,
        created_at: c.created_at,
        updated_at: c.updated_at,
        event_id: c.event_id,
        event: c.event as any,
        source_table: 'event_contacts' as const,
      }));

      // Transform salon_mariage_exposants to unified format
      const unifiedSalonContacts: UnifiedEventContact[] = (salonExposants || []).map(s => ({
        id: s.id,
        full_name: s.contact_name || s.company_name,
        first_name: null,
        last_name: null,
        job_title: s.job_title,
        company_name: s.company_name,
        email: s.email,
        phone: s.phone,
        linkedin_url: s.linkedin_url,
        notes: s.notes,
        outreach_status: s.outreach_status,
        created_at: s.created_at,
        updated_at: s.updated_at,
        event_id: salonEvent?.id || '',
        event: salonEvent || undefined,
        source_table: 'salon_mariage' as const,
        tier: s.tier,
        specialties: s.specialties,
        is_priority: s.is_priority,
      }));

      // Combine and sort by created_at
      const allContacts = [...unifiedEventContacts, ...unifiedSalonContacts]
        .sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return dateB - dateA;
        });

      return allContacts;
    },
  });
}

// Hook pour mettre à jour le statut d'un contact événementiel
export function useUpdateEventContact() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, source_table, ...updates }: Partial<UnifiedEventContact> & { id: string; source_table?: string }) => {
      // Determine which table to update based on source_table
      if (source_table === 'salon_mariage') {
        const { data, error } = await supabase
          .from('salon_mariage_exposants')
          .update({
            outreach_status: updates.outreach_status,
            notes: updates.notes,
          })
          .eq('id', id)
          .select()
          .single();
        
        if (error) throw error;
        return { ...data, source_table: 'salon_mariage' };
      } else {
        const { data, error } = await supabase
          .from('event_contacts')
          .update(updates)
          .eq('id', id)
          .select()
          .single();
        
        if (error) throw error;
        return { ...data, source_table: 'event_contacts' };
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['all-event-contacts-unified'] });
      queryClient.invalidateQueries({ queryKey: ['event-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['salon-exposants'] });
      toast.success('Contact mis à jour');
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

// Stats des contacts événementiels (unified)
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
      acc[eventId] = { count: 0, eventName: c.event?.name || 'Événement inconnu' };
    }
    acc[eventId].count++;
    return acc;
  }, {} as Record<string, { count: number; eventName: string }>) ?? {};

  // Count by source
  const fromSalon = contacts?.filter(c => c.source_table === 'salon_mariage').length ?? 0;
  const fromEvents = contacts?.filter(c => c.source_table === 'event_contacts').length ?? 0;

  return {
    total,
    contacted,
    withEmail,
    withLinkedIn,
    converted,
    byEvent,
    fromSalon,
    fromEvents,
  };
}

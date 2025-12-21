import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Event {
  id: string;
  name: string;
  type: string;
  date_start: string;
  date_end: string | null;
  location: string;
  address: string | null;
  description: string | null;
  website_url: string | null;
  contacts_count: number;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DetectedEvent {
  id: string;
  name: string;
  type: string | null;
  date_start: string | null;
  date_end: string | null;
  location: string | null;
  source: string;
  source_url: string | null;
  description: string | null;
  relevance_score: number;
  is_added: boolean;
  event_id: string | null;
  detected_at: string;
  created_at: string;
}

export interface EventContact {
  id: string;
  event_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  outreach_status: string;
  notes: string | null;
  created_at: string;
}

// Hook pour récupérer tous les événements
export function useEvents() {
  return useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('date_start', { ascending: true });
      
      if (error) throw error;
      return data as Event[];
    },
  });
}

// Hook pour récupérer un événement par ID
export function useEvent(id: string) {
  return useQuery({
    queryKey: ['events', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      
      if (error) throw error;
      return data as Event | null;
    },
    enabled: !!id,
  });
}

// Hook pour récupérer les contacts d'un événement
export function useEventContacts(eventId: string) {
  return useQuery({
    queryKey: ['event-contacts', eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_contacts')
        .select('*')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as EventContact[];
    },
    enabled: !!eventId,
  });
}

// Hook pour créer un événement
export function useCreateEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (event: Omit<Event, 'id' | 'created_at' | 'updated_at' | 'contacts_count'>) => {
      const { data, error } = await supabase
        .from('events')
        .insert(event)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast({ title: 'Événement créé', description: 'L\'événement a été ajouté avec succès.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour mettre à jour un événement
export function useUpdateEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Event> & { id: string }) => {
      const { error } = await supabase
        .from('events')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['events', variables.id] });
      toast({ title: 'Événement mis à jour' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour supprimer un événement
export function useDeleteEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast({ title: 'Événement supprimé' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour les événements détectés
export function useDetectedEvents() {
  return useQuery({
    queryKey: ['detected-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('detected_events')
        .select('*')
        .order('relevance_score', { ascending: false });
      
      if (error) throw error;
      return data as DetectedEvent[];
    },
  });
}

// Hook pour transférer un événement détecté vers le calendrier
export function useTransferDetectedEvent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (detectedEvent: DetectedEvent) => {
      // Créer l'événement dans la table events
      const { data: newEvent, error: eventError } = await supabase
        .from('events')
        .insert({
          name: detectedEvent.name,
          type: detectedEvent.type || 'salon',
          date_start: detectedEvent.date_start,
          date_end: detectedEvent.date_end,
          location: detectedEvent.location || 'À définir',
          description: detectedEvent.description,
          website_url: detectedEvent.source_url,
          status: 'planned',
        })
        .select()
        .single();
      
      if (eventError) throw eventError;

      // Mettre à jour l'événement détecté
      const { error: updateError } = await supabase
        .from('detected_events')
        .update({ 
          is_added: true,
          event_id: newEvent.id 
        })
        .eq('id', detectedEvent.id);
      
      if (updateError) throw updateError;

      return newEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['detected-events'] });
      toast({ 
        title: 'Événement transféré', 
        description: 'L\'événement a été ajouté à votre calendrier.' 
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour ajouter un contact à un événement
export function useAddEventContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (contact: Omit<EventContact, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('event_contacts')
        .insert(contact)
        .select()
        .single();
      
      if (error) throw error;

      // Mettre à jour le compteur de contacts manuellement
      const { data: currentEvent } = await supabase
        .from('events')
        .select('contacts_count')
        .eq('id', contact.event_id)
        .single();
      
      if (currentEvent) {
        await supabase
          .from('events')
          .update({ contacts_count: (currentEvent.contacts_count || 0) + 1 })
          .eq('id', contact.event_id);
      }
      
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['event-contacts', variables.event_id] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      toast({ title: 'Contact ajouté' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Stats des événements
export function useEventsStats() {
  const { data: events } = useEvents();
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const upcomingEvents = events?.filter(e => new Date(e.date_start) > now) ?? [];
  const thisMonthEvents = events?.filter(e => {
    const date = new Date(e.date_start);
    return date.getMonth() === currentMonth && date.getFullYear() === currentYear;
  }) ?? [];
  const attendedEvents = events?.filter(e => e.status === 'attended') ?? [];
  const totalContacts = events?.reduce((sum, e) => sum + (e.contacts_count || 0), 0) ?? 0;

  return {
    total: events?.length ?? 0,
    upcoming: upcomingEvents.length,
    thisMonth: thisMonthEvents.length,
    attended: attendedEvents.length,
    totalContacts,
  };
}

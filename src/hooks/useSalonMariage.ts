import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';

export type SalonExposant = Tables<'salon_mariage_exposants'>;

export function useSalonExposants() {
  return useQuery({
    queryKey: ['salon-mariage-exposants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('salon_mariage_exposants')
        .select('*')
        .order('is_priority', { ascending: false })
        .order('company_name', { ascending: true });
      
      if (error) throw error;
      return data as SalonExposant[];
    },
  });
}

export function useCreateSalonExposant() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (exposant: Omit<SalonExposant, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('salon_mariage_exposants')
        .insert(exposant)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salon-mariage-exposants'] });
    },
  });
}

export function useUpdateSalonExposant() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SalonExposant> & { id: string }) => {
      const { data, error } = await supabase
        .from('salon_mariage_exposants')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salon-mariage-exposants'] });
    },
  });
}

export function useDeleteSalonExposant() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('salon_mariage_exposants')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['salon-mariage-exposants'] });
    },
  });
}

export function useSalonStats() {
  const { data: exposants } = useSalonExposants();
  
  // Count contacted includes all statuses beyond initial contact
  const contactedStatuses = ['contacted', 'met_at_event', 'demo_scheduled', 'follow_up_sent', 'proposal_sent', 'converted'];
  
  return {
    total: exposants?.length ?? 0,
    priority: exposants?.filter(e => e.is_priority)?.length ?? 0,
    contacted: exposants?.filter(e => contactedStatuses.includes(e.outreach_status || ''))?.length ?? 0,
    withEmail: exposants?.filter(e => e.email)?.length ?? 0,
    withLinkedIn: exposants?.filter(e => e.linkedin_url)?.length ?? 0,
  };
}

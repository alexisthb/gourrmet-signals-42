import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type ContactInteraction = Tables<'contact_interactions'>;

export type ActionType = 
  | 'status_change'
  | 'linkedin_message_generated'
  | 'email_generated'
  | 'email_sent'
  | 'linkedin_message_copied'
  | 'email_copied'
  | 'note_added'
  | 'next_action_set';

interface CreateInteractionParams {
  contactId: string;
  actionType: ActionType;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown>;
}

export function useContactInteractions(contactId?: string) {
  return useQuery({
    queryKey: ['contact-interactions', contactId],
    queryFn: async () => {
      if (!contactId) return [];
      
      const { data, error } = await supabase
        .from('contact_interactions')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ContactInteraction[];
    },
    enabled: !!contactId,
  });
}

export function useIntervenedContacts() {
  return useQuery({
    queryKey: ['intervened-contacts'],
    queryFn: async () => {
      // Get all contact IDs that have at least one interaction
      const { data: interactions, error } = await supabase
        .from('contact_interactions')
        .select('contact_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Get unique contact IDs
      const uniqueContactIds = [...new Set(interactions?.map(i => i.contact_id) || [])];
      return uniqueContactIds;
    },
    refetchInterval: 10000,
  });
}

export function useCreateInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ contactId, actionType, oldValue, newValue, metadata }: CreateInteractionParams) => {
      const { data, error } = await (supabase
        .from('contact_interactions') as any)
        .insert({
          contact_id: contactId,
          action_type: actionType,
          old_value: oldValue ?? null,
          new_value: newValue ?? null,
          metadata: metadata || {},
        })
        .select()
        .single();

      if (error) throw error;
      return data as ContactInteraction;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['contact-interactions', variables.contactId] });
      queryClient.invalidateQueries({ queryKey: ['intervened-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
    },
  });
}

export function useUpdateNextAction() {
  const queryClient = useQueryClient();
  const createInteraction = useCreateInteraction();

  return useMutation({
    mutationFn: async ({ 
      contactId, 
      nextActionAt, 
      nextActionNote 
    }: { 
      contactId: string; 
      nextActionAt: string | null; 
      nextActionNote: string | null;
    }) => {
      const { error } = await supabase
        .from('contacts')
        .update({ 
          next_action_at: nextActionAt,
          next_action_note: nextActionNote,
          updated_at: new Date().toISOString()
        })
        .eq('id', contactId);

      if (error) throw error;

      // Log the interaction
      await createInteraction.mutateAsync({
        contactId,
        actionType: 'next_action_set',
        newValue: nextActionNote || undefined,
        metadata: { scheduled_at: nextActionAt }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
    },
  });
}

// Helper function to get a human-readable label for action types
export function getActionTypeLabel(actionType: string): string {
  const labels: Record<string, string> = {
    'status_change': 'Changement de statut',
    'linkedin_message_generated': 'Message LinkedIn généré',
    'email_generated': 'Email généré',
    'email_sent': 'Email envoyé',
    'linkedin_message_copied': 'Message LinkedIn copié',
    'email_copied': 'Email copié',
    'note_added': 'Note ajoutée',
    'next_action_set': 'Prochaine action définie',
  };
  return labels[actionType] || actionType;
}

// Helper function to get icon color for action types
export function getActionTypeColor(actionType: string): string {
  const colors: Record<string, string> = {
    'status_change': 'text-violet-500',
    'linkedin_message_generated': 'text-blue-500',
    'email_generated': 'text-primary',
    'email_sent': 'text-green-500',
    'linkedin_message_copied': 'text-blue-400',
    'email_copied': 'text-primary/70',
    'note_added': 'text-amber-500',
    'next_action_set': 'text-emerald-500',
  };
  return colors[actionType] || 'text-muted-foreground';
}

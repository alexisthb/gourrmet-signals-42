import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SignalInteraction {
  id: string;
  signal_id: string;
  action_type: string;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export type SignalActionType = 
  | 'status_change'
  | 'note_added'
  | 'next_action_set'
  | 'enrichment_triggered'
  | 'contact_created';

interface CreateInteractionParams {
  signalId: string;
  actionType: SignalActionType;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown>;
}

export function useSignalInteractions(signalId?: string) {
  return useQuery({
    queryKey: ['signal-interactions', signalId],
    queryFn: async () => {
      if (!signalId) return [];
      
      const { data, error } = await supabase
        .from('signal_interactions')
        .select('*')
        .eq('signal_id', signalId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SignalInteraction[];
    },
    enabled: !!signalId,
  });
}

export function useIntervenedSignals() {
  return useQuery({
    queryKey: ['intervened-signals'],
    queryFn: async () => {
      const { data: interactions, error } = await supabase
        .from('signal_interactions')
        .select('signal_id')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const uniqueSignalIds = [...new Set(interactions?.map(i => i.signal_id) || [])];
      return uniqueSignalIds;
    },
    refetchInterval: 10000,
  });
}

export function useCreateSignalInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ signalId, actionType, oldValue, newValue, metadata }: CreateInteractionParams) => {
      const { data, error } = await (supabase
        .from('signal_interactions') as any)
        .insert({
          signal_id: signalId,
          action_type: actionType,
          old_value: oldValue ?? null,
          new_value: newValue ?? null,
          metadata: metadata || {},
        })
        .select()
        .single();

      if (error) throw error;
      return data as SignalInteraction;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['signal-interactions', variables.signalId] });
      queryClient.invalidateQueries({ queryKey: ['intervened-signals'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
  });
}

export function useUpdateSignalNextAction() {
  const queryClient = useQueryClient();
  const createInteraction = useCreateSignalInteraction();

  return useMutation({
    mutationFn: async ({ 
      signalId, 
      nextActionAt, 
      nextActionNote 
    }: { 
      signalId: string; 
      nextActionAt: string | null; 
      nextActionNote: string | null;
    }) => {
      const { error } = await supabase
        .from('signals')
        .update({ 
          next_action_at: nextActionAt,
          next_action_note: nextActionNote,
        })
        .eq('id', signalId);

      if (error) throw error;

      await createInteraction.mutateAsync({
        signalId,
        actionType: 'next_action_set',
        newValue: nextActionNote || undefined,
        metadata: { scheduled_at: nextActionAt }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
  });
}

export function getSignalActionTypeLabel(actionType: string): string {
  const labels: Record<string, string> = {
    'status_change': 'Changement de statut',
    'note_added': 'Note ajoutée',
    'next_action_set': 'Prochaine action définie',
    'enrichment_triggered': 'Enrichissement déclenché',
    'contact_created': 'Contact créé',
  };
  return labels[actionType] || actionType;
}

export function getSignalActionTypeColor(actionType: string): string {
  const colors: Record<string, string> = {
    'status_change': 'text-violet-500',
    'note_added': 'text-amber-500',
    'next_action_set': 'text-emerald-500',
    'enrichment_triggered': 'text-blue-500',
    'contact_created': 'text-primary',
  };
  return colors[actionType] || 'text-muted-foreground';
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface TonalCharter {
  id: string;
  charter_data: {
    formality?: {
      level?: string;
      tutoyment?: boolean;
      observations?: string[];
    };
    structure?: {
      max_paragraphs?: number;
      sentence_length?: string;
      bullet_points?: boolean;
      observations?: string[];
    };
    vocabulary?: {
      forbidden_words?: string[];
      preferred_words?: string[];
      forbidden_expressions?: string[];
      preferred_expressions?: string[];
      observations?: string[];
    };
    tone?: {
      style?: string;
      humor_allowed?: boolean;
      energy_level?: string;
      observations?: string[];
    };
    signatures?: {
      preferred?: string[];
      avoided?: string[];
    };
    openings?: {
      preferred?: string[];
      avoided?: string[];
    };
    subjects_email?: {
      max_length?: number;
      style?: string;
      observations?: string[];
    };
    confidence_score?: number;
    patterns_detected?: number;
    summary?: string;
  };
  corrections_count: number;
  last_analysis_at: string | null;
  confidence_score: number;
  is_learning_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageFeedback {
  id: string;
  message_type: 'inmail' | 'email';
  original_message: string;
  edited_message: string;
  original_subject?: string;
  edited_subject?: string;
  context: Record<string, unknown>;
  created_at: string;
}

// Fetch the tonal charter
export function useTonalCharter() {
  return useQuery({
    queryKey: ['tonal-charter'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tonal_charter')
        .select('*')
        .single();

      if (error) throw error;
      return data as TonalCharter;
    },
  });
}

// Fetch recent message feedback for display
export function useMessageFeedback(limit = 10) {
  return useQuery({
    queryKey: ['message-feedback', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_feedback')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as MessageFeedback[];
    },
  });
}

// Toggle learning enabled
export function useToggleLearning() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('tonal_charter')
        .update({ is_learning_enabled: enabled })
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) throw error;
      return enabled;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tonal-charter'] });
    },
  });
}

// Trigger charter update manually
export function useUpdateCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('update-tonal-charter');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tonal-charter'] });
      if (data?.success) {
        toast.success('Charte tonale mise à jour', {
          description: `${data.corrections_analyzed} corrections analysées, confiance: ${Math.round(data.confidence_score * 100)}%`,
        });
      }
    },
    onError: (error) => {
      console.error('Error updating charter:', error);
      toast.error('Erreur lors de la mise à jour de la charte');
    },
  });
}

// Reset charter and feedback
export function useResetCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      // Delete all feedback
      const { error: feedbackError } = await supabase
        .from('message_feedback')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (feedbackError) throw feedbackError;

      // Reset charter to defaults
      const { error: charterError } = await supabase
        .from('tonal_charter')
        .update({
          charter_data: {
            formality: { level: 'neutre', tutoyment: false, observations: [] },
            structure: { max_paragraphs: 3, sentence_length: 'moyenne', observations: [] },
            vocabulary: { forbidden_words: [], preferred_words: [], observations: [] },
            tone: { style: 'professionnel', humor_allowed: false, observations: [] },
            signatures: { preferred: [], avoided: [] },
            openings: { preferred: [], avoided: [] },
          },
          corrections_count: 0,
          last_analysis_at: null,
          confidence_score: 0,
        })
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (charterError) throw charterError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tonal-charter'] });
      queryClient.invalidateQueries({ queryKey: ['message-feedback'] });
      toast.success('Charte tonale réinitialisée');
    },
    onError: (error) => {
      console.error('Error resetting charter:', error);
      toast.error('Erreur lors de la réinitialisation');
    },
  });
}

// Save message feedback (called from dialogs)
export function useSaveMessageFeedback() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      message_type: 'inmail' | 'email';
      original_message: string;
      edited_message: string;
      original_subject?: string;
      edited_subject?: string;
      context?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase.functions.invoke('save-message-feedback', {
        body: params,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tonal-charter'] });
      queryClient.invalidateQueries({ queryKey: ['message-feedback'] });
      
      if (data?.should_update_charter) {
        // Auto-trigger charter update
        supabase.functions.invoke('update-tonal-charter').then(() => {
          queryClient.invalidateQueries({ queryKey: ['tonal-charter'] });
        });
      }
    },
  });
}

// Calculate difference percentage between two strings
export function calculateDiffPercentage(original: string, edited: string): number {
  if (!original || !edited) return 0;
  
  const originalWords = original.toLowerCase().split(/\s+/);
  const editedWords = edited.toLowerCase().split(/\s+/);
  
  const originalSet = new Set(originalWords);
  const editedSet = new Set(editedWords);
  
  const intersection = new Set([...originalSet].filter(x => editedSet.has(x)));
  const union = new Set([...originalSet, ...editedSet]);
  
  const similarity = intersection.size / union.size;
  return (1 - similarity) * 100;
}

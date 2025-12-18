import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Signal, SignalType, SignalStatus } from '@/types/database';

interface SignalFilters {
  minScore?: number;
  type?: SignalType | 'all';
  status?: SignalStatus | 'all';
  period?: '7d' | '30d' | '90d' | 'all';
  search?: string;
}

export function useSignals(filters: SignalFilters = {}) {
  return useQuery({
    queryKey: ['signals', filters],
    queryFn: async () => {
      let query = supabase
        .from('signals')
        .select('*')
        .order('detected_at', { ascending: false });

      if (filters.minScore) {
        query = query.gte('score', filters.minScore);
      }

      if (filters.type && filters.type !== 'all') {
        query = query.eq('signal_type', filters.type);
      }

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.period && filters.period !== 'all') {
        const now = new Date();
        let fromDate: Date;
        switch (filters.period) {
          case '7d':
            fromDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case '30d':
            fromDate = new Date(now.setDate(now.getDate() - 30));
            break;
          case '90d':
            fromDate = new Date(now.setDate(now.getDate() - 90));
            break;
          default:
            fromDate = new Date(0);
        }
        query = query.gte('detected_at', fromDate.toISOString());
      }

      if (filters.search) {
        query = query.ilike('company_name', `%${filters.search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Signal[];
    },
  });
}

export function useSignal(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Signal;
    },
    enabled: !!id,
  });
}

export function useUpdateSignal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Signal> }) => {
      const { data, error } = await supabase
        .from('signals')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['signal'] });
    },
  });
}

export function useSignalStats() {
  return useQuery({
    queryKey: ['signal-stats'],
    queryFn: async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const { data: allSignals, error } = await supabase
        .from('signals')
        .select('id, status, score, detected_at');

      if (error) throw error;

      const signals = allSignals || [];
      const thisWeekSignals = signals.filter(s => new Date(s.detected_at) >= weekAgo);
      const newSignals = signals.filter(s => s.status === 'new');
      const inProgressSignals = signals.filter(s => ['contacted', 'meeting', 'proposal'].includes(s.status));
      const wonSignals = signals.filter(s => s.status === 'won');
      const processedSignals = signals.filter(s => !['new', 'ignored'].includes(s.status));

      return {
        thisWeek: thisWeekSignals.length,
        new: newSignals.length,
        inProgress: inProgressSignals.length,
        conversionRate: processedSignals.length > 0 
          ? Math.round((wonSignals.length / processedSignals.length) * 100) 
          : 0,
        total: signals.length,
      };
    },
  });
}

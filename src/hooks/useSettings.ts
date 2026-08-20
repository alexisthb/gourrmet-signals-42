import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Setting, SearchQuery, ScanLog } from '@/types/database';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('settings') as any)
        .select('*');

      if (error) throw error;

      const settingsMap: Record<string, string> = {};
      (data || []).forEach((s: Setting) => {
        settingsMap[s.key] = s.value;
      });

      return settingsMap;
    },
  });
}

export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      // Use upsert to create or update the setting
      const { data, error } = await (supabase
        .from('settings') as any)
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

export function useSearchQueries() {
  return useQuery({
    queryKey: ['search-queries'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('search_queries') as any)
        .select('*')
        .order('category', { ascending: true });

      if (error) throw error;
      return data as SearchQuery[];
    },
  });
}

export function useToggleSearchQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await (supabase
        .from('search_queries') as any)
        .update({ is_active })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-queries'] });
    },
  });
}

export function useAddSearchQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (query: Omit<SearchQuery, 'id' | 'created_at' | 'last_fetched_at'>) => {
      const { description, ...rest } = query;
      const insertData = description ? { ...rest, description } : rest;
      
      const { data, error } = await (supabase
        .from('search_queries') as any)
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-queries'] });
    },
  });
}

export function useDeleteSearchQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('search_queries') as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-queries'] });
    },
  });
}

export interface ScanLogWithEnrichment extends ScanLog {
  contacts_enriched?: number;
}

export function useScanLogs() {
  return useQuery({
    queryKey: ['scan-logs'],
    queryFn: async () => {
      // Fetch scan logs
      const { data: logs, error } = await (supabase
        .from('scan_logs') as any)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      // For each scan, calculate contacts enriched based on signals created in that time window
      const enrichedLogs: ScanLogWithEnrichment[] = await Promise.all(
        (logs || []).map(async (log: ScanLog) => {
          if (!log.signals_created || log.signals_created === 0) {
            return { ...log, contacts_enriched: 0 };
          }

          // Get signals created during this scan time window
          const startTime = log.started_at || log.created_at;
          const endTime = log.completed_at || new Date().toISOString();

          if (!startTime) return { ...log, contacts_enriched: 0 };

          // Count contacts for signals created during this scan
          const { count, error: countError } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', startTime)
            .lte('created_at', endTime);

          if (countError) {
            console.error('Error counting contacts:', countError);
            return { ...log, contacts_enriched: 0 };
          }

          return { ...log, contacts_enriched: count || 0 };
        })
      );

      return enrichedLogs;
    },
  });
}

export function useRunScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await supabase.functions.invoke('run-full-scan');
      
      if (response.error) {
        throw new Error(response.error.message);
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['signal-stats'] });
      queryClient.invalidateQueries({ queryKey: ['scan-logs'] });
      queryClient.invalidateQueries({ queryKey: ['search-queries'] });
      queryClient.invalidateQueries({ queryKey: ['pending-articles-count'] });
    },
  });
}

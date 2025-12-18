import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Setting, SearchQuery, ScanLog } from '@/types/database';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
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
      const { data, error } = await supabase
        .from('settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
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
      const { data, error } = await supabase
        .from('search_queries')
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
      const { error } = await supabase
        .from('search_queries')
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
      
      const { data, error } = await supabase
        .from('search_queries')
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
      const { error } = await supabase
        .from('search_queries')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['search-queries'] });
    },
  });
}

export function useScanLogs() {
  return useQuery({
    queryKey: ['scan-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scan_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as ScanLog[];
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
    },
  });
}

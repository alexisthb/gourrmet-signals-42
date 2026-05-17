// GR-011 — Hook qui lit la table cron_state pour afficher en UI
// la frequence des scans et la derniere synchronisation.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CronState {
  job_name: string;
  schedule: string;
  description: string | null;
  last_run_at: string | null;
  last_run_status: 'running' | 'completed' | 'failed' | null;
  last_run_duration_ms: number | null;
  last_error: string | null;
  next_run_at: string | null;
  enabled: boolean;
  updated_at: string;
}

export function useCronState(jobName: string) {
  return useQuery({
    queryKey: ['cron-state', jobName],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await ((supabase as any)
        .from('cron_state'))
        .select('*')
        .eq('job_name', jobName)
        .maybeSingle();
      if (error) throw error;
      return data as CronState | null;
    },
  });
}

export function useAllCronStates() {
  return useQuery({
    queryKey: ['cron-state', 'all'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await ((supabase as any)
        .from('cron_state'))
        .select('*')
        .order('job_name');
      if (error) throw error;
      return (data || []) as CronState[];
    },
  });
}

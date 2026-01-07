import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

// Types
export interface PappersPlanSettings {
  id: string;
  plan_name: string;
  monthly_credits: number;
  current_period_start: string;
  current_period_end: string;
  rate_limit_per_second: number;
  results_per_page: number;
  alert_threshold_percent: number;
}

export interface PappersCreditUsage {
  id: string;
  date: string;
  credits_used: number;
  search_credits: number;
  company_credits: number;
  api_calls: number;
  query_id: string | null;
  scan_id: string | null;
  details: Record<string, any>;
}

export interface PappersScanProgress {
  id: string;
  query_id: string | null;
  scan_type: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error';
  anniversary_years: number | null;
  current_page: number;
  total_pages: number | null;
  total_results: number | null;
  processed_results: number;
  date_creation_min: string | null;
  date_creation_max: string | null;
  last_cursor: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditsSummary {
  used: number;
  limit: number;
  remaining: number;
  percent: number;
  isWarning: boolean;
  isCritical: boolean;
  isBlocked: boolean;
}

// Hook pour récupérer les paramètres du forfait
export function usePappersPlanSettings() {
  return useQuery({
    queryKey: ['pappers-plan-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pappers_plan_settings')
        .select('*')
        .single();

      if (error) {
        // Retourner des paramètres par défaut si non configuré
        return {
          id: 'default',
          plan_name: 'Standard',
          monthly_credits: 10000,
          current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
          current_period_end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
          rate_limit_per_second: 2,
          results_per_page: 25,
          alert_threshold_percent: 80,
        } as PappersPlanSettings;
      }

      return data as PappersPlanSettings;
    },
  });
}

// Hook pour récupérer l'utilisation des crédits ce mois
export function usePappersCreditsUsage() {
  const { data: planSettings } = usePappersPlanSettings();

  return useQuery({
    queryKey: ['pappers-credits-usage', planSettings?.current_period_start],
    queryFn: async () => {
      if (!planSettings) return [];

      const { data, error } = await supabase
        .from('pappers_credit_usage')
        .select('*')
        .gte('date', planSettings.current_period_start)
        .lte('date', planSettings.current_period_end)
        .order('date', { ascending: false });

      if (error) throw error;
      return data as PappersCreditUsage[];
    },
    enabled: !!planSettings,
  });
}

// Hook pour le résumé des crédits
export function usePappersCreditsSummary(): CreditsSummary {
  const { data: planSettings } = usePappersPlanSettings();
  const { data: usage } = usePappersCreditsUsage();

  const used = usage?.reduce((sum, row) => sum + (row.credits_used || 0), 0) || 0;
  const limit = planSettings?.monthly_credits || 10000;
  const remaining = limit - used;
  const percent = Math.round((used / limit) * 100);
  const alertThreshold = planSettings?.alert_threshold_percent || 80;

  return {
    used,
    limit,
    remaining,
    percent,
    isWarning: percent >= alertThreshold - 10, // 70%
    isCritical: percent >= alertThreshold, // 80%
    isBlocked: percent >= 100,
  };
}

// Hook pour récupérer les scans en cours
export function usePappersScanProgress(options?: { status?: string[] }) {
  return useQuery({
    queryKey: ['pappers-scan-progress', options?.status],
    queryFn: async () => {
      let query = supabase
        .from('pappers_scan_progress')
        .select('*')
        .order('created_at', { ascending: false });

      if (options?.status && options.status.length > 0) {
        query = query.in('status', options.status);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as PappersScanProgress[];
    },
    refetchInterval: 5000, // Refresh toutes les 5 secondes pour les scans en cours
  });
}

// Hook pour le scan actif
export function useActivePappersScan() {
  return useQuery({
    queryKey: ['pappers-active-scan'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pappers_scan_progress')
        .select('*')
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PappersScanProgress[];
    },
    refetchInterval: 3000,
  });
}

// Hook pour démarrer un scan progressif
export function useStartPappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: {
      queryId?: string;
      years?: number[];
      monthsAhead?: number;
      dryRun?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('run-pappers-scan', {
        body: {
          action: 'start',
          ...params,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pappers-scan-progress'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-active-scan'] });
      
      if (data.dryRun) {
        toast({
          title: '🔬 Mode Simulation',
          description: `${data.scansCreated?.length || 0} scans préparés. Aucun appel API réel.`,
        });
      } else {
        toast({
          title: '🚀 Scan lancé',
          description: data.message,
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur lors du lancement du scan',
        variant: 'destructive',
      });
    },
  });
}

// Hook pour mettre en pause un scan
export function usePausePappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (scanId: string) => {
      const { data, error } = await supabase.functions.invoke('run-pappers-scan', {
        body: {
          action: 'pause',
          scanId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-scan-progress'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-active-scan'] });
      toast({
        title: 'Scan en pause',
        description: 'Le scan a été mis en pause. Vous pouvez le reprendre à tout moment.',
      });
    },
  });
}

// Hook pour reprendre un scan
export function useResumePappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (params: { scanId: string; dryRun?: boolean }) => {
      const { data, error } = await supabase.functions.invoke('run-pappers-scan', {
        body: {
          action: 'resume',
          ...params,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-scan-progress'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-active-scan'] });
      toast({
        title: 'Scan repris',
        description: 'Le scan continue là où il s\'était arrêté.',
      });
    },
  });
}

// Hook pour supprimer un scan
export function useDeletePappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (scanId: string) => {
      const { error } = await supabase
        .from('pappers_scan_progress')
        .delete()
        .eq('id', scanId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-scan-progress'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-active-scan'] });
      toast({
        title: 'Scan supprimé',
      });
    },
  });
}

// Hook pour arrêter un scan
export function useStopPappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (scanId: string) => {
      const { data, error } = await supabase.functions.invoke('run-pappers-scan', {
        body: {
          action: 'stop',
          scanId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-scan-progress'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-active-scan'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      toast({
        title: '⏹️ Scan arrêté',
        description: 'Le scan a été interrompu. Les signaux déjà collectés sont conservés.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur lors de l\'arrêt',
        variant: 'destructive',
      });
    },
  });
}

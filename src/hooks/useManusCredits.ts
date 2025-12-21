import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ManusPlanSettings {
  id: string;
  plan_name: string;
  monthly_credits: number;
  current_period_start: string;
  current_period_end: string;
  alert_threshold_percent: number;
  cost_per_enrichment: number;
}

export interface ManusCreditUsage {
  id: string;
  date: string;
  credits_used: number;
  enrichments_count: number;
  signal_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
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

// Hook pour récupérer les paramètres du forfait Manus
export function useManusPlanSettings() {
  return useQuery({
    queryKey: ['manus-plan-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manus_plan_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      
      // Retourner des paramètres par défaut si non configuré
      if (!data) {
        return {
          id: 'default',
          plan_name: 'Standard',
          monthly_credits: 1000,
          current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
          current_period_end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
          alert_threshold_percent: 80,
          cost_per_enrichment: 1,
        } as ManusPlanSettings;
      }

      return data as ManusPlanSettings;
    },
  });
}

// Hook pour récupérer l'utilisation des crédits Manus ce mois
export function useManusCreditsUsage() {
  const { data: planSettings } = useManusPlanSettings();

  return useQuery({
    queryKey: ['manus-credits-usage', planSettings?.current_period_start],
    queryFn: async () => {
      if (!planSettings) return [];

      const { data, error } = await supabase
        .from('manus_credit_usage')
        .select('*')
        .gte('date', planSettings.current_period_start)
        .lte('date', planSettings.current_period_end)
        .order('date', { ascending: false });

      if (error) throw error;
      return data as ManusCreditUsage[];
    },
    enabled: !!planSettings,
  });
}

// Hook pour le résumé des crédits Manus
export function useManusCreditsSummary(): CreditsSummary {
  const { data: planSettings } = useManusPlanSettings();
  const { data: usage } = useManusCreditsUsage();

  const used = usage?.reduce((sum, row) => sum + Number(row.credits_used || 0), 0) || 0;
  const limit = planSettings?.monthly_credits || 1000;
  const remaining = limit - used;
  const percent = Math.round((used / limit) * 100);
  const alertThreshold = planSettings?.alert_threshold_percent || 80;

  return {
    used,
    limit,
    remaining,
    percent,
    isWarning: percent >= alertThreshold - 10,
    isCritical: percent >= alertThreshold,
    isBlocked: percent >= 100,
  };
}

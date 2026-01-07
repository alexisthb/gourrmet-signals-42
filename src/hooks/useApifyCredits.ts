import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ApifyPlanSettings {
  id: string;
  plan_name: string;
  monthly_credits: number;
  current_period_start: string;
  current_period_end: string;
  alert_threshold_percent: number;
  cost_per_scrape: number;
}

export interface ApifyCreditUsage {
  id: string;
  date: string;
  credits_used: number;
  scrapes_count: number;
  source: 'linkedin' | 'presse';
  post_id: string | null;
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

// Hook pour récupérer les paramètres du forfait Apify
export function useApifyPlanSettings() {
  return useQuery({
    queryKey: ['apify-plan-settings'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('apify_plan_settings') as any)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      
      // Retourner des paramètres par défaut si non configuré
      if (!data) {
        return {
          id: 'default',
          plan_name: 'Starter',
          monthly_credits: 5000,
          current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
          current_period_end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
          alert_threshold_percent: 80,
          cost_per_scrape: 0.5,
        } as ApifyPlanSettings;
      }

      return data as ApifyPlanSettings;
    },
  });
}

// Hook pour récupérer l'utilisation des crédits Apify ce mois
export function useApifyCreditsUsage(source?: 'linkedin' | 'presse') {
  const { data: planSettings } = useApifyPlanSettings();

  return useQuery({
    queryKey: ['apify-credits-usage', planSettings?.current_period_start, source],
    queryFn: async () => {
      if (!planSettings) return [];

      let query = (supabase
        .from('apify_credit_usage') as any)
        .select('*')
        .gte('date', planSettings.current_period_start)
        .lte('date', planSettings.current_period_end)
        .order('date', { ascending: false });

      if (source) {
        query = query.eq('source', source);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as ApifyCreditUsage[];
    },
    enabled: !!planSettings,
  });
}

// Hook pour le résumé des crédits Apify (total)
export function useApifyCreditsSummary(): CreditsSummary {
  const { data: planSettings } = useApifyPlanSettings();
  const { data: usage } = useApifyCreditsUsage();

  const used = usage?.reduce((sum, row) => sum + Number(row.credits_used || 0), 0) || 0;
  const limit = planSettings?.monthly_credits || 5000;
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

// Hook pour le résumé par source
export function useApifyCreditsBySource() {
  const { data: usage } = useApifyCreditsUsage();

  const linkedinUsage = usage?.filter(u => u.source === 'linkedin') || [];
  const presseUsage = usage?.filter(u => u.source === 'presse') || [];

  return {
    linkedin: {
      credits: linkedinUsage.reduce((sum, row) => sum + Number(row.credits_used || 0), 0),
      scrapes: linkedinUsage.reduce((sum, row) => sum + (row.scrapes_count || 0), 0),
    },
    presse: {
      credits: presseUsage.reduce((sum, row) => sum + Number(row.credits_used || 0), 0),
      scrapes: presseUsage.reduce((sum, row) => sum + (row.scrapes_count || 0), 0),
    },
  };
}

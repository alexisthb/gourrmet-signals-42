import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface NewsApiPlanSettings {
  id: string;
  plan_name: string;
  daily_requests: number;
  current_period_start: string;
  alert_threshold_percent: number;
}

export interface NewsApiUsage {
  id: string;
  date: string;
  requests_count: number;
  articles_fetched: number;
  query_id: string | null;
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

// Hook pour récupérer les paramètres du forfait NewsAPI
export function useNewsApiPlanSettings() {
  return useQuery({
    queryKey: ['newsapi-plan-settings'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('newsapi_plan_settings') as any)
        .select('*')
        .maybeSingle();

      if (error) throw error;
      
      // Retourner des paramètres par défaut si non configuré
      if (!data) {
        return {
          id: 'default',
          plan_name: 'Developer',
          daily_requests: 100,
          current_period_start: new Date().toISOString(),
          alert_threshold_percent: 80,
        } as NewsApiPlanSettings;
      }

      return data as NewsApiPlanSettings;
    },
  });
}

// Hook pour récupérer l'utilisation NewsAPI aujourd'hui
export function useNewsApiUsageToday() {
  const today = new Date().toISOString().split('T')[0];

  return useQuery({
    queryKey: ['newsapi-usage-today', today],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('newsapi_usage') as any)
        .select('*')
        .eq('date', today)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as NewsApiUsage[];
    },
  });
}

// Hook pour le résumé des crédits NewsAPI (quotidien)
export function useNewsApiCreditsSummary(): CreditsSummary {
  const { data: planSettings } = useNewsApiPlanSettings();
  const { data: usage } = useNewsApiUsageToday();

  const used = usage?.reduce((sum, row) => sum + Number(row.requests_count || 0), 0) || 0;
  const limit = planSettings?.daily_requests || 100;
  const remaining = Math.max(0, limit - used);
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

// Hook pour les statistiques détaillées
export function useNewsApiStats() {
  const { data: usage } = useNewsApiUsageToday();
  
  const totalRequests = usage?.reduce((sum, row) => sum + (row.requests_count || 0), 0) || 0;
  const totalArticles = usage?.reduce((sum, row) => sum + (row.articles_fetched || 0), 0) || 0;

  return {
    requests: totalRequests,
    articles: totalArticles,
    lastFetch: usage?.[0]?.created_at || null,
  };
}

// Hook pour réinitialiser les compteurs NewsAPI du jour (debug)
export function useResetNewsApiUsage() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];

  return useMutation({
    mutationFn: async () => {
      const { error } = await (supabase
        .from('newsapi_usage') as any)
        .delete()
        .eq('date', today);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['newsapi-usage-today'] });
    },
  });
}

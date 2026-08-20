import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { collectAllPages } from '@/lib/supabasePagination';
import { loadPerplexityTelemetry } from '@/hooks/useProviderTelemetry';

export interface PerplexityStats {
  total: number;
  successful: number;
  successRate: number;
  avgRevenueFound: number;
  todayCount: number;
  thisMonthCount: number;
}

export function usePerplexityStats() {
  return useQuery({
    queryKey: ['perplexity-stats'],
    queryFn: async (): Promise<PerplexityStats> => {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      
      const allUsage = await collectAllPages((from, to) =>
        supabase
          .from('perplexity_usage')
          .select('created_at, success, revenue_found')
          .gte('created_at', startOfMonth)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to),
      );
      const todayUsage = allUsage.filter(d => d.created_at >= startOfDay);
      
      const total = allUsage.length;
      const successful = allUsage.filter(d => d.success).length;
      const totalRevenue = allUsage.reduce((sum, d) => sum + (d.revenue_found || 0), 0);

      return {
        total,
        successful,
        successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
        avgRevenueFound: successful > 0 ? totalRevenue / successful : 0,
        todayCount: todayUsage.length,
        thisMonthCount: total,
      };
    },
  });
}

export function usePerplexityUsageTelemetry() {
  return useQuery({
    queryKey: ['provider-token-telemetry', 'perplexity', new Date().toISOString().slice(0, 7)],
    queryFn: loadPerplexityTelemetry,
    refetchInterval: 60_000,
  });
}

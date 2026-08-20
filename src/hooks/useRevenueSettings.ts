import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Paliers de CA disponibles (en euros)
export const REVENUE_THRESHOLDS = [
  { value: 1_000_000, label: '1M€' },
  { value: 2_000_000, label: '2M€' },
  { value: 5_000_000, label: '5M€' },
  { value: 10_000_000, label: '10M€' },
  { value: 25_000_000, label: '25M€' },
  { value: 50_000_000, label: '50M€' },
  { value: 100_000_000, label: '100M€' },
];

// Plancher absolu (ne peut pas être descendu)
export const REVENUE_FLOOR = 1_000_000;

export interface RevenueSettings {
  min_revenue_presse: number;
  min_revenue_pappers: number;
  min_revenue_linkedin: number;
}

export function useRevenueSettings() {
  return useQuery({
    queryKey: ['revenue-settings'],
    queryFn: async (): Promise<RevenueSettings> => {
      const { data, error } = await (supabase
        .from('settings') as any)
        .select('key, value')
        .in('key', ['min_revenue_presse', 'min_revenue_pappers', 'min_revenue_linkedin']);

      if (error) throw error;

      const settings: RevenueSettings = {
        min_revenue_presse: REVENUE_FLOOR,
        min_revenue_pappers: REVENUE_FLOOR,
        min_revenue_linkedin: REVENUE_FLOOR,
      };

      (data || []).forEach((s: { key: string; value: string }) => {
        const val = parseInt(s.value, 10);
        if (!isNaN(val) && val >= REVENUE_FLOOR) {
          (settings as any)[s.key] = val;
        }
      });

      return settings;
    },
  });
}

export function useUpdateRevenueSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: keyof RevenueSettings; value: number }) => {
      // Ensure value is at least the floor
      const safeValue = Math.max(value, REVENUE_FLOOR);
      
      const { data, error } = await (supabase
        .from('settings') as any)
        .upsert({ key, value: String(safeValue), updated_at: new Date().toISOString() }, { onConflict: 'key' })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['revenue-settings'] });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// Hook pour récupérer les stats d'usage Perplexity
export function usePerplexityUsage() {
  return useQuery({
    queryKey: ['perplexity-usage'],
    queryFn: async () => {
      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      
      const { data, error } = await supabase
        .from('perplexity_usage')
        .select('*')
        .gte('created_at', startOfMonth)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const total = data?.length || 0;
      const successful = data?.filter(d => d.success).length || 0;
      const totalRevenue = data?.reduce((sum, d) => sum + (d.revenue_found || 0), 0) || 0;

      return {
        requests: data || [],
        total,
        successful,
        successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
        avgRevenueFound: successful > 0 ? totalRevenue / successful : 0,
      };
    },
  });
}

// Helper pour formater le CA
export function formatRevenue(revenue: number | null | undefined): string {
  if (!revenue) return 'Inconnu';
  
  if (revenue >= 1_000_000_000) {
    return `${(revenue / 1_000_000_000).toFixed(1)}Md€`;
  }
  if (revenue >= 1_000_000) {
    return `${(revenue / 1_000_000).toFixed(1)}M€`;
  }
  if (revenue >= 1_000) {
    return `${(revenue / 1_000).toFixed(0)}k€`;
  }
  return `${revenue}€`;
}

// Helper pour obtenir l'index du slider à partir d'une valeur
export function getSliderIndex(value: number): number {
  const index = REVENUE_THRESHOLDS.findIndex(t => t.value === value);
  return index >= 0 ? index : 0;
}

// Helper pour obtenir la valeur à partir de l'index du slider
export function getValueFromSliderIndex(index: number): number {
  return REVENUE_THRESHOLDS[index]?.value || REVENUE_FLOOR;
}

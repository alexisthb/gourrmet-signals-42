import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { collectAllPages } from '@/lib/supabasePagination';

export interface ApifyPlanSettings {
  id: string;
  plan_name: string;
  monthly_credits: number;
  monthly_run_limit: number;
  quota_unit: 'actor_runs';
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
  isMeasured: boolean;
  measuredCurrency?: string;
}

// Hook pour récupérer les paramètres du forfait Apify
export function useApifyPlanSettings() {
  return useQuery({
    queryKey: ['apify-plan-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apify_plan_settings')
        .select('*')
        .maybeSingle();

      if (error) throw error;
      
      // Absence de preuve de forfait = aucun crédit disponible.
      if (!data) {
        return {
          id: 'default',
          plan_name: 'Non configuré',
          monthly_credits: 0,
          monthly_run_limit: 0,
          quota_unit: 'actor_runs',
          current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
          current_period_end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
          alert_threshold_percent: 80,
          cost_per_scrape: 0,
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

      return collectAllPages<ApifyCreditUsage>(async (from, to) => {
        let query = supabase
          .from('apify_credit_usage')
          .select('*')
          .gte('date', planSettings.current_period_start)
          .lte('date', planSettings.current_period_end)
          .order('date', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);

        if (source) query = query.eq('source', source);
        const { data, error } = await query;
        return { data: data as ApifyCreditUsage[] | null, error };
      });
    },
    enabled: !!planSettings,
    refetchInterval: 30_000,
    retry: 1,
  });
}

// Hook pour le résumé des crédits Apify (total)
export function useApifyCreditsSummary(): CreditsSummary {
  const { data: planSettings } = useApifyPlanSettings();
  const { data: quotaStatus, isSuccess: quotaMeasured } = useQuery({
    queryKey: [
      'apify-actor-run-quota',
      planSettings?.current_period_start,
      planSettings?.current_period_end,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('apify_actor_run_quota_status', {
        p_at: new Date().toISOString(),
      });
      if (error) throw error;
      const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : null;
      const used = Number(payload?.used);
      const limit = Number(payload?.limit);
      const remaining = Number(payload?.remaining);
      if (
        !payload || payload.unit !== 'actor_runs' ||
        typeof payload.configured !== 'boolean' ||
        !Number.isFinite(used) || used < 0 ||
        !Number.isFinite(limit) || limit < 0 ||
        !Number.isFinite(remaining) || remaining < 0
      ) {
        throw new Error('Réponse quota Apify absente ou invalide');
      }
      return {
        ...payload,
        used,
        limit,
        remaining,
      } as {
        configured: boolean;
        reason: string;
        unit: 'actor_runs';
        used: number;
        limit: number;
        remaining: number;
      };
    },
    enabled: !!planSettings,
  });
  const limit = Math.max(0, Number(quotaStatus?.limit ?? planSettings?.monthly_run_limit ?? 0));
  const used = Math.max(0, Number(quotaStatus?.used ?? 0));
  const remaining = Math.max(0, Number(quotaStatus?.remaining ?? limit - used));
  const today = new Date().toISOString().slice(0, 10);
  const periodCurrent = !!planSettings?.current_period_start && !!planSettings?.current_period_end
    && today >= planSettings.current_period_start.slice(0, 10)
    && today <= planSettings.current_period_end.slice(0, 10);
  const percent = quotaMeasured && limit > 0
    ? Math.min(100, Math.round((used / limit) * 100))
    : 100;
  const warningThreshold = Number(planSettings?.alert_threshold_percent ?? 80);

  return {
    // Le plafond porte sur des runs Actor réservés/consommés. Le coût USD exact
    // reste une télémétrie terminale distincte (`usageTotalUsd`).
    used,
    limit,
    remaining,
    percent,
    isWarning: quotaMeasured && percent >= warningThreshold,
    isCritical: !quotaMeasured || percent >= 95,
    isBlocked: !quotaMeasured || !periodCurrent || limit <= 0 || quotaStatus.configured !== true || remaining <= 0,
    isMeasured: quotaMeasured,
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

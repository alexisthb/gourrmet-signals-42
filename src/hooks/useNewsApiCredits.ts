import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { collectAllPages } from "@/lib/supabasePagination";

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
  isMeasured: boolean;
}

interface NewsApiQuotaStatus {
  day: string;
  used: number;
  limit: number;
  remaining: number;
  legacy_units: number;
  reserved_or_used_units: number;
  measurement_started_at: string;
}

// Hook pour récupérer les paramètres du forfait NewsAPI
export function useNewsApiPlanSettings() {
  return useQuery({
    queryKey: ["newsapi-plan-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newsapi_plan_settings")
        .select("*")
        .maybeSingle();

      if (error) throw error;

      // Absence de preuve de forfait = aucun crédit disponible.
      if (!data) {
        return {
          id: "default",
          plan_name: "Non configuré",
          daily_requests: 0,
          current_period_start: new Date().toISOString(),
          alert_threshold_percent: 80,
        } as NewsApiPlanSettings;
      }

      return data as NewsApiPlanSettings;
    },
  });
}

// Cette RPC lit la même autorité atomique que le backend. Elle inclut les
// réservations en vol et le ledger historique du jour de bascule.
export function useNewsApiQuotaStatus() {
  const { data: planSettings } = useNewsApiPlanSettings();
  const dailyLimit = Math.max(0, Number(planSettings?.daily_requests ?? 0));
  return useQuery({
    queryKey: ["newsapi-quota-status", dailyLimit],
    queryFn: async () => {
      if (dailyLimit <= 0) return null;
      const { data, error } = await supabase.rpc("newsapi_quota_status", {
        p_daily_limit: dailyLimit,
      });
      if (error) throw error;
      return data as unknown as NewsApiQuotaStatus;
    },
    enabled: !!planSettings,
    refetchInterval: 30_000,
  });
}

// Hook pour récupérer l'utilisation NewsAPI aujourd'hui
export function useNewsApiUsageToday() {
  const today = new Date().toISOString().split("T")[0];

  return useQuery({
    queryKey: ["newsapi-usage-today", today],
    queryFn: async () => {
      return collectAllPages<NewsApiUsage>(async (from, to) => {
        const { data, error } = await supabase
          .from("newsapi_usage")
          .select("*")
          .eq("date", today)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        return { data: data as NewsApiUsage[] | null, error };
      });
    },
  });
}

// Hook pour le résumé des crédits NewsAPI (quotidien)
export function useNewsApiCreditsSummary(): CreditsSummary {
  const planQuery = useNewsApiPlanSettings();
  const quotaQuery = useNewsApiQuotaStatus();
  const planSettings = planQuery.data;
  const quota = quotaQuery.data;

  const limit = Math.max(0, Number(planSettings?.daily_requests ?? 0));
  const isMeasured =
    planQuery.isSuccess &&
    (limit <= 0 ||
      (quotaQuery.isSuccess && quota !== null && quota !== undefined));
  const used = isMeasured ? Number(quota?.used ?? 0) : 0;
  const remaining =
    isMeasured && limit > 0 ? Math.max(0, Number(quota?.remaining ?? 0)) : 0;
  const percent =
    isMeasured && limit > 0
      ? Math.min(100, Math.round((used / limit) * 100))
      : 100;
  const alertThreshold = planSettings?.alert_threshold_percent || 80;

  return {
    used,
    limit,
    remaining,
    percent,
    isWarning: isMeasured && percent >= alertThreshold - 10,
    isCritical: !isMeasured || percent >= alertThreshold,
    isBlocked: !isMeasured || limit <= 0 || percent >= 100,
    isMeasured,
  };
}

// Hook pour les statistiques détaillées
export function useNewsApiStats() {
  const { data: usage } = useNewsApiUsageToday();

  const totalRequests =
    usage?.reduce((sum, row) => sum + (row.requests_count || 0), 0) || 0;
  const totalArticles =
    usage?.reduce((sum, row) => sum + (row.articles_fetched || 0), 0) || 0;

  return {
    requests: totalRequests,
    articles: totalArticles,
    lastFetch: usage?.[0]?.created_at || null,
  };
}

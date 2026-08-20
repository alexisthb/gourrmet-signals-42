import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { collectAllPages } from "@/lib/supabasePagination";

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
  reserved_credits: number;
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
  status:
    "pending" | "running" | "paused" | "completed" | "error" | "cancelled";
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
  consumed: number;
  reserved: number;
  limit: number;
  remaining: number;
  percent: number;
  isWarning: boolean;
  isCritical: boolean;
  isBlocked: boolean;
  isMeasured: boolean;
}

interface PappersQuotaStatus {
  used: number;
  reserved: number;
  committed: number;
  configured_limit: number;
  effective_limit: number;
  remaining: number;
  percent: number;
  period_start: string;
  period_end: string;
  period_current: boolean;
  source: "configured_and_metered" | "unconfigured_or_period_invalid";
}

// Hook pour récupérer les paramètres du forfait
export function usePappersPlanSettings() {
  return useQuery({
    queryKey: ["pappers-plan-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pappers_plan_settings")
        .select("*")
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        return {
          id: "default",
          plan_name: "Non configuré",
          monthly_credits: 0,
          current_period_start: new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1,
          )
            .toISOString()
            .split("T")[0],
          current_period_end: new Date(
            new Date().getFullYear(),
            new Date().getMonth() + 1,
            0,
          )
            .toISOString()
            .split("T")[0],
          rate_limit_per_second: 2,
          results_per_page: 25,
          alert_threshold_percent: 80,
        } as PappersPlanSettings;
      }

      return data as PappersPlanSettings;
    },
  });
}

export function usePappersQuotaStatus() {
  const planQuery = usePappersPlanSettings();
  return useQuery({
    queryKey: ["pappers-quota-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pappers_quota_status");
      if (error) throw error;
      const payload =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : null;
      const numericKeys = [
        "used",
        "reserved",
        "committed",
        "configured_limit",
        "effective_limit",
        "remaining",
        "percent",
      ] as const;
      if (
        !payload ||
        numericKeys.some((key) => !Number.isFinite(Number(payload[key]))) ||
        typeof payload.period_current !== "boolean" ||
        (payload.source !== "configured_and_metered" &&
          payload.source !== "unconfigured_or_period_invalid")
      ) {
        throw new Error("Réponse quota Pappers absente ou invalide");
      }
      return Object.fromEntries(
        Object.entries(payload).map(([key, value]) =>
          numericKeys.includes(key as (typeof numericKeys)[number])
            ? [key, Number(value)]
            : [key, value],
        ),
      ) as unknown as PappersQuotaStatus;
    },
    enabled: planQuery.isSuccess,
    refetchInterval: 30_000,
  });
}

// Hook pour récupérer l'utilisation des crédits ce mois
export function usePappersCreditsUsage() {
  const { data: planSettings } = usePappersPlanSettings();

  return useQuery({
    queryKey: ["pappers-credits-usage", planSettings?.current_period_start],
    queryFn: async () => {
      if (!planSettings) return [];

      return collectAllPages<PappersCreditUsage>(async (from, to) => {
        const { data, error } = await supabase
          .from("pappers_credit_usage")
          .select("*")
          .gte("date", planSettings.current_period_start)
          .lte("date", planSettings.current_period_end)
          .order("date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        return { data: data as PappersCreditUsage[] | null, error };
      });
    },
    enabled: !!planSettings,
  });
}

// Hook pour le résumé des crédits
export function usePappersCreditsSummary(): CreditsSummary {
  const planQuery = usePappersPlanSettings();
  const quotaQuery = usePappersQuotaStatus();
  const planSettings = planQuery.data;
  const quota = quotaQuery.data;
  const isMeasured = planQuery.isSuccess && quotaQuery.isSuccess && !!quota;
  const consumed = isMeasured ? quota.used : 0;
  const reserved = isMeasured ? quota.reserved : 0;
  const used = isMeasured ? quota.committed : 0;
  const limit = isMeasured ? quota.effective_limit : 0;
  const remaining = isMeasured ? quota.remaining : 0;
  const percent = isMeasured ? Math.min(100, quota.percent) : 100;
  const alertThreshold = planSettings?.alert_threshold_percent || 80;

  return {
    used,
    consumed,
    reserved,
    limit,
    remaining,
    percent,
    isWarning: isMeasured && percent >= alertThreshold - 10,
    isCritical: !isMeasured || percent >= alertThreshold,
    isBlocked:
      !isMeasured ||
      quota.period_current !== true ||
      quota.source !== "configured_and_metered" ||
      limit <= 0 ||
      remaining <= 0,
    isMeasured,
  };
}

// Hook pour récupérer les scans en cours
export function usePappersScanProgress(options?: { status?: string[] }) {
  return useQuery({
    queryKey: ["pappers-scan-progress", options?.status],
    queryFn: async () => {
      return collectAllPages<PappersScanProgress>(async (from, to) => {
        let query = supabase
          .from("pappers_scan_progress")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to);
        if (options?.status && options.status.length > 0) {
          query = query.in("status", options.status);
        }
        const { data, error } = await query;
        return { data: data as PappersScanProgress[] | null, error };
      });
    },
    refetchInterval: 5000, // Refresh toutes les 5 secondes pour les scans en cours
  });
}

// Hook pour le scan actif
export function useActivePappersScan() {
  return useQuery({
    queryKey: ["pappers-active-scan"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pappers_scan_progress")
        .select("*")
        .in("status", ["pending", "running", "paused"])
        .order("created_at", { ascending: false });

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
    mutationFn: async (params: { queryId?: string; dryRun?: boolean }) => {
      const { data, error } = await supabase.functions.invoke(
        "run-pappers-scan",
        {
          body: {
            action: "start",
            ...params,
          },
        },
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pappers-scan-progress"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-active-scan"] });

      if (data.dryRun) {
        toast({
          title: "🔬 Mode Simulation",
          description: `${data.queriesToProcess || 0} requête(s) active(s). Aucun appel API réel.`,
        });
      } else {
        toast({
          title: data.status === "completed" ? "Scan terminé" : "🚀 Scan lancé",
          description: data.message,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description:
          error instanceof Error
            ? error.message
            : "Erreur lors du lancement du scan",
        variant: "destructive",
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
      const { data, error } = await supabase.functions.invoke(
        "run-pappers-scan",
        {
          body: {
            action: "pause",
            scanId,
          },
        },
      );

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pappers-scan-progress"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-active-scan"] });
      toast({
        title: "Scan en pause",
        description:
          "Le scan a été mis en pause. Vous pouvez le reprendre à tout moment.",
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
      const { data, error } = await supabase.functions.invoke(
        "run-pappers-scan",
        {
          body: {
            action: "resume",
            ...params,
          },
        },
      );

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pappers-scan-progress"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-active-scan"] });
      toast({
        title: "Scan repris",
        description: "Le scan continue là où il s'était arrêté.",
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
      const { error } = await supabase.rpc("delete_pappers_scan", {
        p_scan_id: scanId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pappers-scan-progress"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-active-scan"] });
      toast({
        title: "Scan supprimé",
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
      const { data, error } = await supabase.functions.invoke(
        "run-pappers-scan",
        {
          body: {
            action: "stop",
            scanId,
          },
        },
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, scanId) => {
      // Mise à jour optimiste : le bouton doit basculer immédiatement sur "Lancer scan"
      const nowIso = new Date().toISOString();

      queryClient.setQueriesData(
        { queryKey: ["pappers-scan-progress"] },
        (old: PappersScanProgress[] | undefined) => {
          if (!old) return old;
          return old.map((s) =>
            s.id === scanId
              ? {
                  ...s,
                  status: "cancelled",
                  completed_at: nowIso,
                  error_message: s.error_message ?? "Scan arrêté manuellement",
                  updated_at: nowIso,
                }
              : s,
          );
        },
      );

      queryClient.setQueryData(
        ["pappers-active-scan"],
        (old: PappersScanProgress[] | undefined) =>
          old?.filter((s) => s.id !== scanId),
      );

      queryClient.invalidateQueries({ queryKey: ["pappers-scan-progress"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-active-scan"] });
      queryClient.invalidateQueries({ queryKey: ["pappers-signals"] });

      toast({
        title: "⏹️ Scan arrêté",
        description:
          "Le scan a été interrompu. Les signaux déjà collectés sont conservés.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description:
          error instanceof Error ? error.message : "Erreur lors de l'arrêt",
        variant: "destructive",
      });
    },
  });
}

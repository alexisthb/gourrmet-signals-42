import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSettings } from '@/hooks/useSettings';
import type { Signal, SignalType, SignalStatus, PipelineStatus } from '@/types/database';
import { collectAllPages } from '@/lib/supabasePagination';

interface SignalFilters {
  minScore?: number;
  type?: SignalType | 'all';
  status?: SignalStatus | 'all';
  pipelineStatus?: PipelineStatus | 'all';
  period?: '7d' | '30d' | '90d' | 'all';
  search?: string;
  excludeTypes?: SignalType[];
  excludeSourceNames?: string[];
  // Filtres géographiques
  geoZoneIds?: string[];
  priorityOnly?: boolean;
  // Filtre CA minimum (en euros)
  minRevenue?: number;
}

export function useSignals(filters: SignalFilters = {}) {
  // Réglage "score minimum d'affichage" (Settings → Général). On l'applique comme
  // plancher de score sur toutes les listes de signaux. On prend le max entre ce
  // réglage et le minScore éventuellement passé en param (le filtre le plus strict
  // gagne). Si le réglage n'est pas défini, comportement inchangé.
  const { data: settings } = useSettings();
  const minScoreDisplayRaw = settings?.min_score_display;
  const minScoreDisplay =
    minScoreDisplayRaw !== undefined && minScoreDisplayRaw !== ''
      ? parseInt(minScoreDisplayRaw, 10)
      : undefined;
  const effectiveMinScore = Math.max(
    filters.minScore ?? 0,
    Number.isFinite(minScoreDisplay) ? (minScoreDisplay as number) : 0,
  );

  return useQuery({
    queryKey: ['signals', filters, effectiveMinScore],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      let fromDateIso: string | undefined;
      if (filters.period && filters.period !== 'all') {
        const days = filters.period === '7d' ? 7 : filters.period === '30d' ? 30 : 90;
        fromDateIso = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
      }

      let signals = await collectAllPages<Signal>((from, to) => {
        let query: any = supabase
          .from('signals')
          .select('*')
          .order('detected_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        if (effectiveMinScore > 0) query = query.gte('score', effectiveMinScore);
        if (filters.type && filters.type !== 'all') query = query.eq('signal_type', filters.type);
        if (filters.excludeTypes?.length) query = query.not('signal_type', 'in', `(${filters.excludeTypes.join(',')})`);
        if (filters.excludeSourceNames?.length) query = query.not('source_name', 'in', `(${filters.excludeSourceNames.join(',')})`);
        if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
        if (filters.pipelineStatus && filters.pipelineStatus !== 'all') query = query.eq('pipeline_status', filters.pipelineStatus);
        if (fromDateIso) query = query.gte('detected_at', fromDateIso);
        if (filters.search) query = query.ilike('company_name', `%${filters.search}%`);
        return query;
      });
      
      // Filtrage CA côté client (car le champ revenue peut être null)
      if (filters.minRevenue && filters.minRevenue > 0) {
        signals = signals.filter(s => {
          const revenue = (s as any).revenue;
          // Si pas de revenue connu, on garde le signal (évite de filtrer trop agressivement)
          if (!revenue) return true;
          return revenue >= filters.minRevenue!;
        });
      }
      
      return signals;
    },
  });
}

export function useSignal(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('signals') as any)
        .select('*, raw_articles(published_at)')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      // Flatten the article data
      const signal = {
        ...data,
        article_published_at: data.raw_articles?.published_at || null,
      };
      delete (signal as any).raw_articles;
      
      return signal as Signal & { article_published_at: string | null };
    },
    enabled: !!id,
  });
}

export function useUpdateSignal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Signal> }) => {
      const { data, error } = await (supabase
        .from('signals') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['signal'] });
    },
  });
}

export function useSignalStats(filters: Pick<SignalFilters, 'type' | 'excludeTypes' | 'excludeSourceNames'> = {}) {
  return useQuery({
    queryKey: ['signal-stats', filters],
    queryFn: async () => {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const allSignals = await collectAllPages<any>((from, to) => {
        let query = (supabase.from('signals') as any)
          .select('id, status, score, detected_at, enrichment_status, signal_type, source_name')
          .order('detected_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        if (filters.type && filters.type !== 'all') query = query.eq('signal_type', filters.type);
        if (filters.excludeTypes?.length) query = query.not('signal_type', 'in', `(${filters.excludeTypes.join(',')})`);
        if (filters.excludeSourceNames?.length) query = query.not('source_name', 'in', `(${filters.excludeSourceNames.join(',')})`);
        return query;
      });

      const enrichments = await collectAllPages<any>((from, to) =>
        (supabase.from('company_enrichment') as any)
          .select('signal_id, enrichment_source, status')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to)
      );

      const signals = allSignals;
      const enrichmentMap = new Map<string, any>();
      for (const enrichment of enrichments) {
        if (!enrichmentMap.has(enrichment.signal_id)) {
          enrichmentMap.set(enrichment.signal_id, enrichment);
        }
      }

      const thisWeekSignals = signals.filter((s: any) => new Date(s.detected_at) >= weekAgo);
      const newSignals = signals.filter((s: any) => s.status === 'new');
      const inProgressSignals = signals.filter((s: any) => ['contacted', 'meeting', 'proposal'].includes(s.status));
      const wonSignals = signals.filter((s: any) => s.status === 'won');
      const processedSignals = signals.filter((s: any) => !['new', 'ignored'].includes(s.status));

      // Count enriched signals
      const enrichedSignals = signals.filter((s: any) =>
        s.enrichment_status === 'completed' || (enrichmentMap.get(s.id) as any)?.status === 'completed'
      );

      const inProgressEnrichmentStatuses = new Set([
        'pending',
        'processing',
        'manus_processing',
        'linkedin_processing',
        'dropcontact_processing',
      ]);
      const enrichingSignals = signals.filter((s: any) =>
        inProgressEnrichmentStatuses.has(s.enrichment_status) ||
        inProgressEnrichmentStatuses.has((enrichmentMap.get(s.id) as any)?.status)
      );

      return {
        thisWeek: thisWeekSignals.length,
        new: newSignals.length,
        inProgress: inProgressSignals.length,
        conversionRate: processedSignals.length > 0
          ? Math.round((wonSignals.length / processedSignals.length) * 100)
          : 0,
        total: signals.length,
        enriched: enrichedSignals.length,
        enriching: enrichingSignals.length,
      };
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}

export function usePendingArticlesCount() {
  return useQuery({
    queryKey: ['pending-articles-count'],
    queryFn: async () => {
      const { count, error } = await (supabase
        .from('raw_articles') as any)
        .select('*', { count: 'exact', head: true })
        .eq('processed', false);

      if (error) throw error;
      return count || 0;
    },
  });
}

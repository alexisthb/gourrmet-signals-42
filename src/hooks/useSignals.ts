import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Signal, SignalType, SignalStatus } from '@/types/database';

interface SignalFilters {
  minScore?: number;
  type?: SignalType | 'all';
  status?: SignalStatus | 'all';
  period?: '7d' | '30d' | '90d' | 'all';
  search?: string;
  excludeTypes?: SignalType[];
  excludeSourceNames?: string[];
  // Filtres géographiques
  geoZoneIds?: string[];
  priorityOnly?: boolean;
}

export function useSignals(filters: SignalFilters = {}) {
  return useQuery({
    queryKey: ['signals', filters],
    queryFn: async () => {
      // Jointure avec raw_articles pour les données géographiques
      let query = supabase
        .from('signals')
        .select(`
          *,
          raw_articles!signals_article_id_fkey (
            geo_zone_id,
            geo_priority,
            detected_city,
            detected_region,
            geo_zones (
              id,
              name,
              color,
              priority
            )
          )
        `)
        .order('detected_at', { ascending: false });

      if (filters.minScore) {
        query = query.gte('score', filters.minScore);
      }

      if (filters.type && filters.type !== 'all') {
        query = query.eq('signal_type', filters.type);
      }

      if (filters.excludeTypes && filters.excludeTypes.length > 0) {
        query = query.not('signal_type', 'in', `(${filters.excludeTypes.join(',')})`);
      }

      if (filters.excludeSourceNames && filters.excludeSourceNames.length > 0) {
        query = query.not('source_name', 'in', `(${filters.excludeSourceNames.join(',')})`);
      }

      if (filters.status && filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      if (filters.period && filters.period !== 'all') {
        const now = new Date();
        let fromDate: Date;
        switch (filters.period) {
          case '7d':
            fromDate = new Date(now.setDate(now.getDate() - 7));
            break;
          case '30d':
            fromDate = new Date(now.setDate(now.getDate() - 30));
            break;
          case '90d':
            fromDate = new Date(now.setDate(now.getDate() - 90));
            break;
          default:
            fromDate = new Date(0);
        }
        query = query.gte('detected_at', fromDate.toISOString());
      }

      if (filters.search) {
        query = query.ilike('company_name', `%${filters.search}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Transformer les données pour aplatir les infos géo
      let signals = (data || []).map((s: any) => ({
        ...s,
        geo_zone_id: s.raw_articles?.geo_zone_id || null,
        geo_priority: s.raw_articles?.geo_priority || 100,
        detected_city: s.raw_articles?.detected_city || null,
        detected_region: s.raw_articles?.detected_region || null,
        geo_zone: s.raw_articles?.geo_zones || null,
      }));
      
      // Filtrer par zones géographiques si spécifié
      if (filters.geoZoneIds && filters.geoZoneIds.length > 0) {
        signals = signals.filter((s: any) => 
          s.geo_zone_id && filters.geoZoneIds!.includes(s.geo_zone_id)
        );
      }
      
      // Filtrer par priorité uniquement
      if (filters.priorityOnly) {
        signals = signals.filter((s: any) => s.geo_priority < 99);
      }
      
      // Trier par priorité géographique puis par date
      signals.sort((a: any, b: any) => {
        // D'abord par priorité (plus petit = plus prioritaire)
        if (a.geo_priority !== b.geo_priority) {
          return a.geo_priority - b.geo_priority;
        }
        // Ensuite par date (plus récent en premier)
        return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
      });
      
      return signals as (Signal & {
        geo_zone_id?: string | null;
        geo_priority?: number;
        detected_city?: string | null;
        detected_region?: string | null;
        geo_zone?: { id: string; name: string; color: string; priority: number } | null;
      })[];
    },
  });
}

export function useSignal(id: string) {
  return useQuery({
    queryKey: ['signal', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
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
      const { data, error } = await supabase
        .from('signals')
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

      // Fetch signals with enrichment info
      let query = supabase
        .from('signals')
        .select('id, status, score, detected_at, enrichment_status, signal_type, source_name');

      if (filters.type && filters.type !== 'all') {
        query = query.eq('signal_type', filters.type);
      }

      if (filters.excludeTypes && filters.excludeTypes.length > 0) {
        query = query.not('signal_type', 'in', `(${filters.excludeTypes.join(',')})`);
      }

      if (filters.excludeSourceNames && filters.excludeSourceNames.length > 0) {
        query = query.not('source_name', 'in', `(${filters.excludeSourceNames.join(',')})`);
      }

      const { data: allSignals, error } = await query;

      if (error) throw error;

      // Fetch company enrichments to check which were auto-enriched
      const { data: enrichments } = await supabase
        .from('company_enrichment')
        .select('signal_id, enrichment_source, status');

      const signals = allSignals || [];
      const enrichmentMap = new Map((enrichments || []).map(e => [e.signal_id, e]));

      const thisWeekSignals = signals.filter(s => new Date(s.detected_at) >= weekAgo);
      const newSignals = signals.filter(s => s.status === 'new');
      const inProgressSignals = signals.filter(s => ['contacted', 'meeting', 'proposal'].includes(s.status));
      const wonSignals = signals.filter(s => s.status === 'won');
      const processedSignals = signals.filter(s => !['new', 'ignored'].includes(s.status));

      // Count enriched signals
      const enrichedSignals = signals.filter(s =>
        s.enrichment_status === 'completed' || enrichmentMap.get(s.id)?.status === 'completed'
      );

      // Count enriching in progress (manus_processing)
      const enrichingSignals = signals.filter(s =>
        s.enrichment_status === 'manus_processing' ||
        enrichmentMap.get(s.id)?.status === 'manus_processing'
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
      const { count, error } = await supabase
        .from('raw_articles')
        .select('*', { count: 'exact', head: true })
        .eq('processed', false);

      if (error) throw error;
      return count || 0;
    },
  });
}

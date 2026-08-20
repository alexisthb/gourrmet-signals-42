import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { collectAllPages } from '@/lib/supabasePagination';

// Types
export interface PappersQuery {
  id: string;
  name: string;
  type: 'anniversary' | 'nomination' | 'capital_increase' | 'transfer' | 'creation';
  is_active: boolean;
  parameters: Record<string, any>;
  last_run_at: string | null;
  signals_count: number;
  created_at: string;
  updated_at: string;
}

export interface PappersSignal {
  id: string;
  query_id: string | null;
  company_name: string;
  siren: string | null;
  signal_type: string;
  signal_detail: string | null;
  relevance_score: number;
  company_data: Record<string, any>;
  processed: boolean;
  transferred_to_signals: boolean;
  signal_id: string | null;
  detected_at: string;
  created_at: string;
  // Champs géographiques
  geo_zone_id?: string | null;
  geo_priority?: number;
  detected_city?: string | null;
  detected_region?: string | null;
  geo_zone?: { id: string; name: string; color: string; priority: number } | null;
  // Statut du signal transféré (jointure côté client sur signals via signal_id).
  // null si non transféré (pas encore de ligne dans signals).
  signal_status?: import('@/types/database').SignalStatus | null;
  signal_pipeline_status?: import('@/types/database').PipelineStatus | null;
}

// Fetch all Pappers queries
export function usePappersQueries() {
  return useQuery({
    queryKey: ['pappers-queries'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('pappers_queries') as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PappersQuery[];
    },
  });
}

// Fetch all Pappers signals avec filtrage géographique et CA
export function usePappersSignals(options?: { 
  processed?: boolean; 
  limit?: number;
  geoZoneIds?: string[];
  priorityOnly?: boolean;
  minRevenue?: number;
}) {
  return useQuery({
    queryKey: ['pappers-signals', options],
    queryFn: async () => {
      const fetchPage = (from: number, to: number) => {
        let query: any = supabase
          .from('pappers_signals')
          .select(`
            *,
            geo_zones (id, name, color, priority)
          `)
          .order('detected_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        if (options?.processed !== undefined) query = query.eq('processed', options.processed);
        if (options?.geoZoneIds?.length) query = query.in('geo_zone_id', options.geoZoneIds);
        return query;
      };
      let data: any[];
      if (options?.limit) {
        const firstPage = await fetchPage(0, options.limit - 1);
        if (firstPage.error) throw firstPage.error;
        data = firstPage.data || [];
      } else {
        data = await collectAllPages<any>(fetchPage);
      }
      
      // Mapping pour ajouter geo_zone depuis la relation
      let signals = (data || []).map((s: any) => ({
        ...s,
        geo_zone: s.geo_zones || null,
      })) as PappersSignal[];

      // Jointure côté client sur signals (status + pipeline_status).
      // ⚠️ PAS de .in('id', [800+ UUID]) : la liste partait dans l'URL de la requête GET,
      // qui explosait la limite de longueur -> jointure vide -> pastille "Prêts à envoyer"
      // à 0 et compteur à zéro (bug vu par l'opératrice). On fait UNE requête bornée sur
      // tous les signaux Pappers (~1 par transfert) et on mappe par id. Fail-safe : si la
      // requête échoue, les statuts restent null mais la LISTE s'affiche quand même.
      try {
        const linked = await collectAllPages<any>((from, to) =>
          (supabase.from('signals') as any)
            .select('id, status, pipeline_status')
            .eq('source_name', 'Pappers')
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to)
        );
        const byId = new Map<string, { status: any; pipeline_status: any }>(
          (linked || []).map((r: any) => [r.id, r])
        );
        signals = signals.map((s) => {
          const l = s.signal_id ? byId.get(s.signal_id) : null;
          return {
            ...s,
            signal_status: l?.status ?? null,
            signal_pipeline_status: l?.pipeline_status ?? null,
          };
        });
      } catch (e) {
        console.error('[usePappersSignals] jointure statuts signals échouée (liste affichée sans statuts):', e);
      }
      
      // Filtrage prioritaire côté client
      if (options?.priorityOnly) {
        signals = signals.filter(s => s.geo_zone && (s.geo_zone.priority ?? 99) < 99);
      }
      
      // Filtrage CA côté client
      if (options?.minRevenue && options.minRevenue > 0) {
        signals = signals.filter(s => {
          const revenue = (s as any).revenue || (s.company_data as any)?.chiffre_affaires;
          // Si pas de revenue connu, on garde le signal
          if (!revenue) return true;
          return revenue >= options.minRevenue!;
        });
      }
      
      return signals;
    },
  });
}

// Pappers signals stats
// Les compteurs sont calculés via des requêtes count exactes (head:true) plutôt
// que dérivés d'une liste chargée avec limit:20 (qui plafonnait pending/transferred).
export function usePappersStats() {
  return useQuery({
    queryKey: ['pappers-stats'],
    queryFn: async () => {
      // Fenêtre 7 jours glissants pour le KPI "Cette semaine"
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [
        totalRes,
        anniversariesRes,
        nominationsRes,
        pendingRes,
        transferredRes,
        thisWeekRes,
      ] = await Promise.all([
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true }),
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true })
          .eq('signal_type', 'anniversary'),
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true })
          .eq('signal_type', 'nomination'),
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true })
          .eq('processed', false),
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true })
          .eq('transferred_to_signals', true),
        (supabase.from('pappers_signals') as any)
          .select('*', { count: 'exact', head: true })
          .gte('detected_at', weekAgo),
      ]);

      const firstError =
        totalRes.error || anniversariesRes.error || nominationsRes.error ||
        pendingRes.error || transferredRes.error || thisWeekRes.error;
      if (firstError) throw firstError;

      return {
        total: totalRes.count || 0,
        anniversaries: anniversariesRes.count || 0,
        nominations: nominationsRes.count || 0,
        pending: pendingRes.count || 0,
        transferred: transferredRes.count || 0,
        thisWeek: thisWeekRes.count || 0,
      };
    },
  });
}

// Create a new query
export function useCreatePappersQuery() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (query: Omit<PappersQuery, 'id' | 'created_at' | 'updated_at' | 'last_run_at' | 'signals_count'>) => {
      const { data, error } = await (supabase
        .from('pappers_queries') as any)
        .insert(query)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-queries'] });
      toast({
        title: 'Requête créée',
        description: 'La nouvelle requête Pappers a été ajoutée.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur lors de la création',
        variant: 'destructive',
      });
    },
  });
}

// Update query
export function useUpdatePappersQuery() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PappersQuery> & { id: string }) => {
      const { data, error } = await (supabase
        .from('pappers_queries') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-queries'] });
    },
  });
}

// Delete query
export function useDeletePappersQuery() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('pappers_queries') as any)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-queries'] });
      toast({
        title: 'Requête supprimée',
        description: 'La requête a été supprimée.',
      });
    },
  });
}

// Run Pappers scan
export function useRunPappersScan() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (queryId?: string) => {
      const { data, error } = await supabase.functions.invoke('fetch-pappers', {
        body: { queryId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-stats'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-queries'] });
      toast({
        title: 'Scan Pappers terminé',
        description: `${data?.signalsCount || 0} nouveaux signaux détectés.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Erreur de scan',
        description: error instanceof Error ? error.message : 'Erreur lors du scan Pappers',
        variant: 'destructive',
      });
    },
  });
}

// Mark signal as processed
export function useMarkPappersSignalProcessed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (signalId: string) => {
      const { error } = await supabase.rpc('mark_pappers_signal_processed', {
        p_pappers_signal_id: signalId,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-stats'] });
    },
  });
}

// Transfer signal to main signals table.
// `silent` supprime le toast de succès pour le transfert TRANSPARENT (auto-transfert à
// l'ouverture d'un signal Pappers) — la gestion Pappers réutilise l'interface Presse, qui
// s'appuie sur une ligne `signals`. Les erreurs restent notifiées dans tous les cas.
export function useTransferToSignals(options?: { silent?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (pappersSignal: PappersSignal) => {
      const { data, error } = await supabase.rpc('transfer_pappers_signal', {
        p_pappers_signal_id: pappersSignal.id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      if (!options?.silent) {
        toast({
          title: 'Signal transféré',
          description: 'Le signal a été ajouté à votre liste principale.',
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Erreur lors du transfert',
        variant: 'destructive',
      });
    },
  });
}

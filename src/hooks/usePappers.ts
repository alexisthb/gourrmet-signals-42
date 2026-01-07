import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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

// Fetch all Pappers signals
export function usePappersSignals(options?: { 
  processed?: boolean; 
  limit?: number;
  geoZoneIds?: string[];
  priorityOnly?: boolean;
}) {
  return useQuery({
    queryKey: ['pappers-signals', options],
    queryFn: async () => {
      let query = (supabase
        .from('pappers_signals') as any)
        .select(`
          *,
          geo_zones (
            id,
            name,
            color,
            priority
          )
        `)
        .order('detected_at', { ascending: false });

      if (options?.processed !== undefined) {
        query = query.eq('processed', options.processed);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Transformer les données
      let signals = (data || []).map((s: any) => ({
        ...s,
        geo_zone: s.geo_zones || null,
      }));
      
      // Filtrer par zones géographiques
      if (options?.geoZoneIds && options.geoZoneIds.length > 0) {
        signals = signals.filter((s: any) => 
          s.geo_zone_id && options.geoZoneIds!.includes(s.geo_zone_id)
        );
      }
      
      // Filtrer par priorité uniquement
      if (options?.priorityOnly) {
        signals = signals.filter((s: any) => (s.geo_priority || 100) < 99);
      }
      
      // Trier par priorité géographique puis par date
      signals.sort((a: any, b: any) => {
        const aPriority = a.geo_priority || 100;
        const bPriority = b.geo_priority || 100;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        return new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime();
      });
      
      return signals as PappersSignal[];
    },
  });
}

// Pappers signals stats
export function usePappersStats() {
  return useQuery({
    queryKey: ['pappers-stats'],
    queryFn: async () => {
      const { data: signals, error } = await (supabase
        .from('pappers_signals') as any)
        .select('signal_type, processed');

      if (error) throw error;

      const total = signals?.length || 0;
      const anniversaries = signals?.filter((s: any) => s.signal_type === 'anniversary').length || 0;
      const nominations = signals?.filter((s: any) => s.signal_type === 'nomination').length || 0;
      const pending = signals?.filter((s: any) => !s.processed).length || 0;

      return { total, anniversaries, nominations, pending };
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
      const { error } = await (supabase
        .from('pappers_signals') as any)
        .update({ processed: true })
        .eq('id', signalId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      queryClient.invalidateQueries({ queryKey: ['pappers-stats'] });
    },
  });
}

// Transfer signal to main signals table
export function useTransferToSignals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (pappersSignal: PappersSignal) => {
      // Create signal in main signals table
      const { data: newSignal, error: signalError } = await (supabase
        .from('signals') as any)
        .insert({
          company_name: pappersSignal.company_name,
          signal_type: pappersSignal.signal_type === 'anniversary' ? 'anniversaire' : 
                       pappersSignal.signal_type === 'nomination' ? 'nomination' : 'levee',
          event_detail: pappersSignal.signal_detail,
          score: Math.round(pappersSignal.relevance_score / 20), // Convert 0-100 to 1-5
          source_name: 'Pappers',
          status: 'new',
        })
        .select()
        .single();

      if (signalError) throw signalError;

      // Update pappers_signal
      const { error: updateError } = await (supabase
        .from('pappers_signals') as any)
        .update({ 
          transferred_to_signals: true, 
          processed: true,
          signal_id: newSignal.id 
        })
        .eq('id', pappersSignal.id);

      if (updateError) throw updateError;

      return newSignal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pappers-signals'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      toast({
        title: 'Signal transféré',
        description: 'Le signal a été ajouté à votre liste principale.',
      });
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

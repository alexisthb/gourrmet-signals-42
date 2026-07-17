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
      let query = supabase
        .from('pappers_signals')
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
      
      // Filtrage par zones géographiques
      if (options?.geoZoneIds && options.geoZoneIds.length > 0) {
        query = query.in('geo_zone_id', options.geoZoneIds);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Mapping pour ajouter geo_zone depuis la relation
      let signals = (data || []).map((s: any) => ({
        ...s,
        geo_zone: s.geo_zones || null,
      })) as PappersSignal[];

      // Jointure côté client sur signals (status + pipeline_status) : la FK signal_id
      // n'est pas déclarée dans les types générés donc on évite l'embed PostgREST.
      const signalIds = Array.from(
        new Set(signals.map((s) => s.signal_id).filter((v): v is string => !!v))
      );
      if (signalIds.length > 0) {
        const { data: linked } = await (supabase.from('signals') as any)
          .select('id, status, pipeline_status')
          .in('id', signalIds);
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
      }
      
      // Filtrage prioritaire côté client
      if (options?.priorityOnly) {
        signals = signals.filter(s => s.geo_zone && (s.geo_zone.priority ?? 0) > 0);
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

// Déduit la taille estimée (CHECK signals.estimated_size: PME/ETI/Grand Compte/Inconnu)
// à partir de l'effectif Pappers (chaîne de tranche, ex "100 à 199 salariés").
function deriveEstimatedSize(companyData: Record<string, any>): string {
  const raw = String(companyData?.effectif ?? '');
  // 1er nombre de la chaîne = borne basse de la tranche. NE PAS strip tous les non-chiffres :
  // "100 à 199 salariés" deviendrait "100199" -> Grand Compte à tort. On prend "100".
  const m = raw.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 'Inconnu';
  if (n >= 5000) return 'Grand Compte';
  if (n >= 250) return 'ETI';
  return 'PME';
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
      // Idempotence : la clé cache ['pappers-signal', id] n'est PAS invalidée par ce mutation,
      // donc à la ré-ouverture rapide d'un signal Pappers le wrapper peut relancer le transfert
      // sur un état périmé (signal_id encore null en cache). On relit l'état FRAIS en base : si
      // déjà transféré, on renvoie la ligne signals existante au lieu d'en créer une 2e (sinon
      // doublon de signal + contacts/enrichissement orphelins).
      const { data: fresh } = await (supabase.from('pappers_signals') as any)
        .select('signal_id')
        .eq('id', pappersSignal.id)
        .maybeSingle();
      if (fresh?.signal_id) {
        const { data: existing } = await (supabase.from('signals') as any)
          .select('*')
          .eq('id', fresh.signal_id)
          .maybeSingle();
        if (existing) return existing;
      }

      const cd = (pappersSignal.company_data || {}) as Record<string, any>;
      // On copie TOUTES les données riches pour que la ligne signals ne soit pas plus pauvre
      // que son origine Pappers (avant : CA, secteur, taille, date de détection étaient perdus).
      const revenue =
        (pappersSignal as any).revenue ??
        (typeof cd.chiffre_affaires === 'number' ? cd.chiffre_affaires : null);
      const revenueSource =
        (pappersSignal as any).revenue_source ?? (revenue ? 'pappers' : null);

      // Create signal in main signals table
      const { data: newSignal, error: signalError } = await (supabase
        .from('signals') as any)
        .insert({
          company_name: pappersSignal.company_name,
          // Mapping interne Pappers -> taxonomie signals presse (cf. SIGNAL_TYPE_CONFIG).
          // Avant: tout ce qui n'était ni anniversary/nomination tombait sur 'levee' —
          // notamment 'transfer' (changement de siège) et 'creation' (entreprise récente)
          // étaient transférés comme de fausses levées. Corrigé:
          signal_type:
            pappersSignal.signal_type === 'anniversary' ? 'anniversaire' :
            pappersSignal.signal_type === 'nomination' ? 'nomination' :
            pappersSignal.signal_type === 'capital_increase' ? 'levee' :
            pappersSignal.signal_type === 'transfer' ? 'expansion' :
            pappersSignal.signal_type === 'creation' ? 'creation' :
            'levee', // fallback prudent
          event_detail: pappersSignal.signal_detail,
          // relevance_score 0-100 -> 1-5, borné au CHECK (BETWEEN 1 AND 5). Sans le clamp,
          // un score < 10 donnait 0 -> violation de contrainte -> transfert en échec.
          score: Math.max(1, Math.min(5, Math.round((pappersSignal.relevance_score || 0) / 20))),
          source_name: 'Pappers',
          status: 'new',
          sector: (typeof cd.libelle_code_naf === 'string' ? cd.libelle_code_naf : null),
          estimated_size: deriveEstimatedSize(cd),
          revenue,
          revenue_source: revenueSource,
          detected_at: pappersSignal.detected_at,
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

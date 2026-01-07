import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface EventExhibitor {
  id: string;
  event_id: string | null;
  scrap_session_id: string | null;
  name: string;
  category: string | null;
  description: string | null;
  website: string | null;
  source_url: string;
  images: string[];
  qualification_score: number;
  target_category: string | null;
  stand_number: string | null;
  email: string | null;
  phone: string | null;
  siren: string | null;
  company_size: string | null;
  revenue: string | null;
  growth_rate: string | null;
  city: string | null;
  region: string | null;
  contact_name: string | null;
  contact_role: string | null;
  linkedin_url: string | null;
  enrichment_status: string;
  enriched_at: string | null;
  is_contacted: boolean;
  notes: string | null;
  scraped_at: string;
  created_at: string;
}

export interface ScrapSession {
  id: string;
  event_id: string | null;
  source_url: string;
  status: string;
  apify_run_id: string | null;
  exhibitors_found: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// Hook pour récupérer les exposants
export function useEventExhibitors(sessionId?: string) {
  return useQuery({
    queryKey: ['event-exhibitors', sessionId],
    queryFn: async () => {
      let query = (supabase
        .from('event_exhibitors') as any)
        .select('*')
        .order('qualification_score', { ascending: false });

      if (sessionId) {
        query = query.eq('scrap_session_id', sessionId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as EventExhibitor[];
    },
  });
}

// Hook pour récupérer les sessions de scraping
export function useScrapSessions() {
  return useQuery({
    queryKey: ['scrap-sessions'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('scrap_sessions') as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ScrapSession[];
    },
  });
}

// Hook pour récupérer une session spécifique
export function useScrapSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['scrap-session', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      
      const { data, error } = await (supabase
        .from('scrap_sessions') as any)
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      return data as ScrapSession;
    },
    enabled: !!sessionId,
    refetchInterval: (query) => {
      // Refetch toutes les 3 secondes si en cours
      if ((query.state.data as ScrapSession)?.status === 'running') return 3000;
      return false;
    },
  });
}

// Hook pour lancer un scraping
export function useStartScraping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ sourceUrl, eventId }: { sourceUrl: string; eventId?: string }) => {
      const { data, error } = await supabase.functions.invoke('scrape-event-exhibitors', {
        body: { 
          action: 'start_scrape', 
          sourceUrl,
          eventId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['scrap-sessions'] });
      toast({
        title: 'Scraping lancé',
        description: `Session créée : ${data.sessionId}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Hook pour vérifier le statut d'un scraping
export function useCheckScrapingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.functions.invoke('scrape-event-exhibitors', {
        body: { 
          action: 'check_status', 
          sessionId,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scrap-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
    },
  });
}

// Hook pour enrichir un exposant via Manus AI
export function useEnrichExhibitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (exhibitorId: string) => {
      // Récupérer l'exposant
      const { data: exhibitor, error: fetchError } = await (supabase
        .from('event_exhibitors') as any)
        .select('*')
        .eq('id', exhibitorId)
        .single();

      if (fetchError) throw fetchError;

      // Mettre à jour le statut
      await (supabase
        .from('event_exhibitors') as any)
        .update({ enrichment_status: 'enriching' })
        .eq('id', exhibitorId);

      // Appeler Manus AI pour enrichir
      const { data: manusData, error: manusError } = await supabase.functions.invoke('enrich-exhibitor-manus', {
        body: { 
          exhibitorId,
          exhibitorName: exhibitor.name,
          website: exhibitor.website,
          category: exhibitor.category,
        },
      });

      if (manusError) {
        // Si Manus n'est pas disponible, marquer comme "en attente"
        await (supabase
          .from('event_exhibitors') as any)
          .update({ enrichment_status: 'pending' })
          .eq('id', exhibitorId);
        
        throw new Error(manusError.message || 'Erreur lors de l\'enrichissement');
      }

      if (manusData?.success) {
        return { success: true, enriched: true, taskId: manusData.taskId };
      }

      // Si pas d'enrichissement possible
      await (supabase
        .from('event_exhibitors') as any)
        .update({ enrichment_status: 'no_data' })
        .eq('id', exhibitorId);

      return { success: true, enriched: false };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
      if (data.taskId) {
        toast({
          title: 'Enrichissement lancé',
          description: 'Manus AI recherche les contacts (peut prendre quelques minutes)',
        });
      } else {
        toast({
          title: data.enriched ? 'Enrichissement réussi' : 'Pas de données',
          description: data.enriched 
            ? 'Les informations ont été ajoutées' 
            : 'Aucune donnée trouvée pour cet exposant',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

// Hook pour mettre à jour un exposant
export function useUpdateExhibitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EventExhibitor> }) => {
      const { data, error } = await (supabase
        .from('event_exhibitors') as any)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
    },
  });
}

// Hook pour exporter en CSV
export function useExportExhibitors() {
  return useMutation({
    mutationFn: async (exhibitors: EventExhibitor[]) => {
      const headers = [
        'Nom', 'Catégorie', 'Score', 'Site Web', 'Email', 'Téléphone',
        'Ville', 'Région', 'CA', 'Effectif', 'Contact', 'Rôle'
      ];
      
      const rows = exhibitors.map(e => [
        e.name,
        e.category || '',
        e.qualification_score.toString(),
        e.website || '',
        e.email || '',
        e.phone || '',
        e.city || '',
        e.region || '',
        e.revenue || '',
        e.company_size || '',
        e.contact_name || '',
        e.contact_role || '',
      ]);

      const csv = [
        headers.join(';'),
        ...rows.map(r => r.map(cell => `"${cell}"`).join(';'))
      ].join('\n');

      // Télécharger
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `exposants_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);

      return { success: true };
    },
  });
}

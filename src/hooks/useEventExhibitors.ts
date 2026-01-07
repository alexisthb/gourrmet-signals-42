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

export function useEventExhibitors(sessionId?: string) {
  return useQuery({
    queryKey: ['event-exhibitors', sessionId],
    queryFn: async () => {
      let query = supabase
        .from('event_exhibitors')
        .select('*')
        .order('qualification_score', { ascending: false });

      if (sessionId) {
        query = query.eq('scrap_session_id', sessionId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as EventExhibitor[];
    },
  });
}

export function useScrapSessions() {
  return useQuery({
    queryKey: ['scrap-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scrap_sessions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ScrapSession[];
    },
  });
}

export function useScrapSession(sessionId: string | null) {
  return useQuery({
    queryKey: ['scrap-session', sessionId],
    queryFn: async () => {
      if (!sessionId) return null;
      
      const { data, error } = await supabase
        .from('scrap_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (error) throw error;
      return data as ScrapSession;
    },
    enabled: !!sessionId,
    refetchInterval: (query) => {
      if (query.state.data?.status === 'running') return 3000;
      return false;
    },
  });
}

export function useStartScraping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ sourceUrl, eventId }: { sourceUrl: string; eventId?: string }) => {
      const { data, error } = await supabase.functions.invoke('scrape-event-exhibitors', {
        body: { action: 'start_scrape', sourceUrl, eventId },
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

export function useCheckScrapingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.functions.invoke('scrape-event-exhibitors', {
        body: { action: 'check_status', sessionId },
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

export function useEnrichExhibitor() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (exhibitorId: string) => {
      await supabase
        .from('event_exhibitors')
        .update({ enrichment_status: 'enriching' })
        .eq('id', exhibitorId);

      const { data: exhibitor, error: fetchError } = await supabase
        .from('event_exhibitors')
        .select('*')
        .eq('id', exhibitorId)
        .single();

      if (fetchError) throw fetchError;

      const { data, error } = await supabase.functions.invoke('enrich-exhibitor-manus', {
        body: { 
          exhibitorId: exhibitor.id,
          exhibitorName: exhibitor.name,
          exhibitorWebsite: exhibitor.website,
        },
      });

      if (error) {
        await supabase
          .from('event_exhibitors')
          .update({ enrichment_status: 'failed', notes: error.message })
          .eq('id', exhibitorId);
        throw error;
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
      toast({
        title: 'Enrichissement lancé',
        description: data?.message || 'Recherche en cours...',
      });
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
      toast({
        title: 'Erreur',
        description: error.message,
        variant: 'destructive',
      });
    },
  });
}

export function useUpdateExhibitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<EventExhibitor> }) => {
      const { data, error } = await supabase
        .from('event_exhibitors')
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

export function useExportExhibitors() {
  return useMutation({
    mutationFn: async (exhibitors: EventExhibitor[]) => {
      const headers = ['Nom', 'Catégorie', 'Score', 'Site Web', 'Email', 'Téléphone', 'Ville', 'Région', 'CA', 'Effectif', 'Contact', 'Rôle'];
      
      const rows = exhibitors.map(e => [
        e.name, e.category || '', e.qualification_score.toString(), e.website || '',
        e.email || '', e.phone || '', e.city || '', e.region || '',
        e.revenue || '', e.company_size || '', e.contact_name || '', e.contact_role || '',
      ]);

      const csv = [headers.join(';'), ...rows.map(r => r.map(cell => `"${cell}"`).join(';'))].join('\n');

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

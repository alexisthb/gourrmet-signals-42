import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Tables } from '@/integrations/supabase/types';

// Use database types directly
export type EventExhibitor = Tables<'event_exhibitors'>;
export type ScrapSession = Tables<'scrap_sessions'>;

export function useEventExhibitors(sessionId?: string) {
  return useQuery({
    queryKey: ['event-exhibitors', sessionId],
    queryFn: async () => {
      let query = supabase
        .from('event_exhibitors')
        .select('*')
        .order('created_at', { ascending: false });

      if (sessionId) {
        query = query.eq('id', sessionId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
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
      return data || [];
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
      return data;
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
        .update({ enrichment_status: 'enriching' } as never)
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
          exhibitorName: exhibitor.company_name,
          exhibitorWebsite: exhibitor.website_url,
        },
      });

      if (error) {
        await supabase
          .from('event_exhibitors')
          .update({ enrichment_status: 'failed', notes: error.message } as never)
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
        .update(updates as never)
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
      const headers = ['Nom', 'Catégorie', 'Site Web', 'Email', 'Téléphone', 'Contact', 'Statut'];
      
      const rows = exhibitors.map(e => [
        e.company_name, 
        e.category || '', 
        e.website_url || '',
        e.contact_email || '', 
        e.contact_phone || '', 
        e.contact_name || '', 
        e.outreach_status || '',
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

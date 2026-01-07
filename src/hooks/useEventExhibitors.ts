import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

// Note: Les tables event_exhibitors et scrap_sessions n'existent pas encore dans la base de données
// Ces hooks sont stub pour éviter les erreurs de build

export function useEventExhibitors(_sessionId?: string) {
  return useQuery({
    queryKey: ['event-exhibitors', _sessionId],
    queryFn: async () => {
      // Table non disponible - retourner un tableau vide
      return [] as EventExhibitor[];
    },
  });
}

export function useScrapSessions() {
  return useQuery({
    queryKey: ['scrap-sessions'],
    queryFn: async () => {
      // Table non disponible - retourner un tableau vide
      return [] as ScrapSession[];
    },
  });
}

export function useScrapSession(_sessionId: string | null) {
  return useQuery({
    queryKey: ['scrap-session', _sessionId],
    queryFn: async () => {
      // Table non disponible
      return null as ScrapSession | null;
    },
    enabled: !!_sessionId,
  });
}

export function useStartScraping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (_params: { sourceUrl: string; eventId?: string }) => {
      toast({
        title: 'Fonctionnalité non disponible',
        description: 'La table event_exhibitors n\'existe pas encore.',
        variant: 'destructive',
      });
      throw new Error('Table non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scrap-sessions'] });
    },
  });
}

export function useCheckScrapingStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_sessionId: string) => {
      throw new Error('Table non disponible');
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
    mutationFn: async (_exhibitorId: string) => {
      toast({
        title: 'Fonctionnalité non disponible',
        description: 'La table event_exhibitors n\'existe pas encore.',
        variant: 'destructive',
      });
      throw new Error('Table non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
    },
  });
}

export function useUpdateExhibitor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_params: { id: string; updates: Partial<EventExhibitor> }) => {
      throw new Error('Table non disponible');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-exhibitors'] });
    },
  });
}

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

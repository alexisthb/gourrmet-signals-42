import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LinkedInSource {
  id: string;
  name: string;
  source_type: 'profile' | 'company';
  linkedin_url: string;
  is_active: boolean;
  last_scraped_at: string | null;
  posts_count: number;
  engagers_count: number;
  created_at: string;
  updated_at: string;
}

export function useLinkedInSources() {
  return useQuery({
    queryKey: ['linkedin-sources'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linkedin_sources')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as LinkedInSource[];
    },
  });
}

export function useAddLinkedInSource() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (source: {
      name: string;
      source_type: 'profile' | 'company';
      linkedin_url: string;
    }) => {
      const { data, error } = await supabase
        .from('linkedin_sources')
        .insert(source)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      toast({ title: 'Source ajoutée', description: 'La source LinkedIn a été ajoutée.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

export function useUpdateLinkedInSource() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LinkedInSource> & { id: string }) => {
      const { error } = await supabase
        .from('linkedin_sources')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      toast({ title: 'Source mise à jour' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

export function useDeleteLinkedInSource() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('linkedin_sources')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      toast({ title: 'Source supprimée' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

export function useToggleLinkedInSource() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('linkedin_sources')
        .update({ is_active })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: (_, { is_active }) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      toast({ title: is_active ? 'Source activée' : 'Source désactivée' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour lancer le scan LinkedIn via Manus (orchestration complète)
export function useScrapeLinkedIn() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async () => {
      // Appeler la nouvelle fonction Manus
      const { data, error } = await supabase.functions.invoke('scan-linkedin-manus', {
        body: { maxPosts: 4 },
      });
      
      // Gérer l'erreur de crédits épuisés (402)
      if (data?.error_code === 'MANUS_CREDIT_LIMIT') {
        throw new Error(data.message || 'Crédits Manus épuisés');
      }
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-scan-progress'] });
      toast({ 
        title: 'Scan Manus lancé', 
        description: data.message || `Scan en cours pour ${data.sources_count || 0} sources` 
      });
    },
    onError: (error: Error) => {
      const isCreditError = error.message.includes('Crédits Manus épuisés') || error.message.includes('crédit');
      toast({ 
        title: isCreditError ? '⚠️ Crédits insuffisants' : 'Erreur de scan', 
        description: error.message, 
        variant: 'destructive' 
      });
    },
  });
}

// Hook pour récupérer les scans LinkedIn en cours
export function useLinkedInScanProgress() {
  return useQuery({
    queryKey: ['linkedin-scan-progress'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linkedin_scan_progress')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (error) throw error;
      return data;
    },
    refetchInterval: 10000, // Refetch toutes les 10 secondes
  });
}

// Hook pour vérifier le statut d'un scan Manus
export function useCheckLinkedInScanStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ scan_id, manus_task_id }: { scan_id?: string; manus_task_id?: string }) => {
      const { data, error } = await supabase.functions.invoke('check-linkedin-scan-status', {
        body: { scan_id, manus_task_id },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-scan-progress'] });

      if (data.is_complete && data.scan?.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
        queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
        queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
        queryClient.invalidateQueries({ queryKey: ['signals'] });
        queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
        queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
        toast({
          title: 'Scan terminé',
          description: `${data.scan.posts_found || 0} posts, ${data.scan.engagers_found || 0} engagers, ${data.scan.contacts_enriched || 0} contacts créés`
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour transférer les engagers existants vers contacts
export function useTransferEngagersToContacts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('transfer-engagers-to-contacts');
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      toast({ 
        title: 'Transfert terminé', 
        description: `${data.transferred} engagers transférés vers les contacts` 
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

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

// Hook pour lancer le scan complet (sources -> posts -> reactions)
export function useScrapeLinkedIn() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('scrape-linkedin-engagers', {
        body: { action: 'full_scan' },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-sources'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      toast({ 
        title: 'Scan terminé', 
        description: `${data.newPosts || 0} nouveaux posts, ${data.engagersFound || 0} engagers` 
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur de scan', description: error.message, variant: 'destructive' });
    },
  });
}

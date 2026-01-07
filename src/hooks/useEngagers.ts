import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LinkedInPost {
  id: string;
  post_url: string;
  source_id: string | null;
  title: string | null;
  content: string | null;
  published_at: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  last_scraped_at: string | null;
  created_at: string;
}

export interface LinkedInEngager {
  id: string;
  post_id: string | null;
  name: string;
  headline: string | null;
  company: string | null;
  linkedin_url: string | null;
  engagement_type: 'like' | 'comment' | 'share';
  comment_text: string | null;
  is_prospect: boolean;
  transferred_to_contacts: boolean;
  contact_id: string | null;
  scraped_at: string;
  created_at: string;
  linkedin_posts?: {
    id: string;
    post_url: string;
    title: string | null;
    published_at: string | null;
  } | null;
  // Champs géographiques
  geo_zone_id?: string | null;
  geo_priority?: number;
  detected_city?: string | null;
  detected_region?: string | null;
  geo_zone?: { id: string; name: string; color: string; priority: number } | null;
}

// Hook pour les posts LinkedIn
export function useLinkedInPosts() {
  return useQuery({
    queryKey: ['linkedin-posts'],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('linkedin_posts') as any)
        .select('*')
        .order('published_at', { ascending: false });
      
      if (error) throw error;
      return data as LinkedInPost[];
    },
  });
}

// Hook pour les engagers
export function useEngagers(options?: {
  geoZoneIds?: string[];
  priorityOnly?: boolean;
}) {
  return useQuery({
    queryKey: ['linkedin-engagers', options],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from('linkedin_engagers') as any)
        .select(`
          *,
          linkedin_posts (
            id,
            post_url,
            title,
            published_at
          ),
          geo_zones (
            id,
            name,
            color,
            priority
          )
        `)
        .order('scraped_at', { ascending: false });
      
      if (error) throw error;
      
      // Transformer les données
      let engagers = (data || []).map((e: any) => ({
        ...e,
        geo_zone: e.geo_zones || null,
      }));
      
      // Filtrer par zones géographiques
      if (options?.geoZoneIds && options.geoZoneIds.length > 0) {
        engagers = engagers.filter((e: any) => 
          e.geo_zone_id && options.geoZoneIds!.includes(e.geo_zone_id)
        );
      }
      
      // Filtrer par priorité uniquement
      if (options?.priorityOnly) {
        engagers = engagers.filter((e: any) => (e.geo_priority || 100) < 99);
      }
      
      // Trier par priorité géographique puis par date
      engagers.sort((a: any, b: any) => {
        const aPriority = a.geo_priority || 100;
        const bPriority = b.geo_priority || 100;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        return new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime();
      });
      
      return engagers as LinkedInEngager[];
    },
  });
}

// Hook pour les stats des engagers
export function useEngagersStats() {
  const { data: engagers } = useEngagers();
  
  return {
    total: engagers?.length ?? 0,
    likes: engagers?.filter(e => e.engagement_type === 'like').length ?? 0,
    comments: engagers?.filter(e => e.engagement_type === 'comment').length ?? 0,
    shares: engagers?.filter(e => e.engagement_type === 'share').length ?? 0,
    prospects: engagers?.filter(e => e.is_prospect).length ?? 0,
  };
}

// Hook pour ajouter un post
export function useAddPost() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (post: { post_url: string; title?: string; published_at?: string }) => {
      const { data, error } = await (supabase
        .from('linkedin_posts') as any)
        .insert(post)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
      toast({ title: 'Post ajouté', description: 'Le post LinkedIn a été ajouté.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour marquer comme prospect
export function useToggleProspect() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async ({ id, is_prospect }: { id: string; is_prospect: boolean }) => {
      const { error } = await (supabase
        .from('linkedin_engagers') as any)
        .update({ is_prospect })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      toast({ title: 'Statut mis à jour' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour ajouter un engager manuellement
export function useAddEngager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (engager: {
      name: string;
      headline?: string;
      company?: string;
      linkedin_url?: string;
      engagement_type: 'like' | 'comment' | 'share';
      post_id?: string;
      is_prospect?: boolean;
    }) => {
      const { data, error } = await (supabase
        .from('linkedin_engagers') as any)
        .insert(engager)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      toast({ title: 'Engager ajouté' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour supprimer un engager
export function useDeleteEngager() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        .from('linkedin_engagers') as any)
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      toast({ title: 'Engager supprimé' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour lancer le scan Apify
export function useScrapeEngagers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('scrape-linkedin-engagers', {
        body: { action: 'scrape' },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-engagers'] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
      toast({ 
        title: 'Scan terminé', 
        description: `${data.engagersFound} engagers trouvés` 
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur de scan', description: error.message, variant: 'destructive' });
    },
  });
}

// Hook pour ajouter un post via edge function
export function useAddLinkedInPost() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  return useMutation({
    mutationFn: async (postUrl: string) => {
      const { data, error } = await supabase.functions.invoke('scrape-linkedin-engagers', {
        body: { action: 'add_post', postUrl },
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-posts'] });
      toast({ title: 'Post ajouté', description: 'Le post LinkedIn a été ajouté à la liste.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    },
  });
}

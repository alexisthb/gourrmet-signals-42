import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface LinkedInPost {
  id: string;
  post_url: string;
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
}

// Hook pour les posts LinkedIn
export function useLinkedInPosts() {
  return useQuery({
    queryKey: ['linkedin-posts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linkedin_posts')
        .select('*')
        .order('published_at', { ascending: false });
      
      if (error) throw error;
      return data as LinkedInPost[];
    },
  });
}

// Hook pour les engagers
export function useEngagers() {
  return useQuery({
    queryKey: ['linkedin-engagers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('linkedin_engagers')
        .select(`
          *,
          linkedin_posts (
            id,
            post_url,
            title,
            published_at
          )
        `)
        .order('scraped_at', { ascending: false });
      
      if (error) throw error;
      return data as LinkedInEngager[];
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
      const { data, error } = await supabase
        .from('linkedin_posts')
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
      const { error } = await supabase
        .from('linkedin_engagers')
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
      const { data, error } = await supabase
        .from('linkedin_engagers')
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
      const { error } = await supabase
        .from('linkedin_engagers')
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

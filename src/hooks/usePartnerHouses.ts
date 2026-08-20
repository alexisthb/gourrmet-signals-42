import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface PartnerHouse {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  instagram_url: string | null;
  description: string | null;
  category: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface PartnerNews {
  id: string;
  house_id: string;
  title: string;
  content: string | null;
  news_type: 'product' | 'event' | 'press' | 'social';
  image_url: string | null;
  source_url: string | null;
  published_at: string | null;
  event_date: string | null;
  event_location: string | null;
  product_name: string | null;
  product_category: string | null;
  is_featured: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  partner_houses?: PartnerHouse;
}

export function usePartnerHouses() {
  return useQuery({
    queryKey: ['partner-houses'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partner_houses')
        .select('*')
        .order('name');

      if (error) throw error;
      return data as PartnerHouse[];
    },
  });
}

export function usePartnerHouse(id: string | undefined) {
  return useQuery({
    queryKey: ['partner-house', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('partner_houses')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as PartnerHouse;
    },
    enabled: !!id,
  });
}

export function usePartnerNews(houseId?: string) {
  return useQuery({
    queryKey: ['partner-news', houseId],
    queryFn: async () => {
      let query = supabase
        .from('partner_news')
        .select('*, partner_houses(name, logo_url)')
        .order('published_at', { ascending: false });

      if (houseId) {
        query = query.eq('house_id', houseId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PartnerNews[];
    },
  });
}

export function useCreatePartnerHouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (house: Omit<PartnerHouse, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('partner_houses')
        .insert(house)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-houses'] });
      toast.success('Maison partenaire créée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la création');
      console.error(error);
    },
  });
}

export function useUpdatePartnerHouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PartnerHouse> & { id: string }) => {
      const { data, error } = await supabase
        .from('partner_houses')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-houses'] });
      toast.success('Maison mise à jour');
    },
    onError: (error) => {
      toast.error('Erreur lors de la mise à jour');
      console.error(error);
    },
  });
}

export function useDeletePartnerHouse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('partner_houses')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-houses'] });
      toast.success('Maison supprimée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la suppression');
      console.error(error);
    },
  });
}

export function useCreatePartnerNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (news: Omit<PartnerNews, 'id' | 'created_at' | 'updated_at' | 'partner_houses'>) => {
      const { data, error } = await supabase
        .from('partner_news')
        .insert(news)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-news'] });
      toast.success('Actualité créée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la création');
      console.error(error);
    },
  });
}

export function useUpdatePartnerNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PartnerNews> & { id: string }) => {
      const { data, error } = await supabase
        .from('partner_news')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-news'] });
      toast.success('Actualité mise à jour');
    },
    onError: (error) => {
      toast.error('Erreur lors de la mise à jour');
      console.error(error);
    },
  });
}

export function useDeletePartnerNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('partner_news')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['partner-news'] });
      toast.success('Actualité supprimée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la suppression');
      console.error(error);
    },
  });
}

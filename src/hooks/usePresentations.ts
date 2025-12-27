import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface Presentation {
  id: string;
  title: string;
  description: string | null;
  file_url: string | null;
  thumbnail_url: string | null;
  file_type: string | null;
  slides_count: number | null;
  is_active: boolean | null;
  display_order: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export function usePresentations() {
  return useQuery({
    queryKey: ['presentations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('presentations')
        .select('*')
        .order('display_order', { ascending: true });

      if (error) throw error;
      return data as Presentation[];
    },
  });
}

export function usePresentation(id: string | undefined) {
  return useQuery({
    queryKey: ['presentation', id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('presentations')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return data as Presentation | null;
    },
    enabled: !!id,
  });
}

export function useCreatePresentation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (presentation: Omit<Presentation, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('presentations')
        .insert(presentation)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      toast.success('Présentation créée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la création');
      console.error(error);
    },
  });
}

export function useUpdatePresentation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Presentation> & { id: string }) => {
      const { data, error } = await supabase
        .from('presentations')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      toast.success('Présentation mise à jour');
    },
    onError: (error) => {
      toast.error('Erreur lors de la mise à jour');
      console.error(error);
    },
  });
}

export function useDeletePresentation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('presentations')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] });
      toast.success('Présentation supprimée');
    },
    onError: (error) => {
      toast.error('Erreur lors de la suppression');
      console.error(error);
    },
  });
}

export function useUploadPresentationFile() {
  return useMutation({
    mutationFn: async ({ file, presentationId }: { file: File; presentationId: string }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${presentationId}.${fileExt}`;
      const filePath = `files/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('presentations')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('presentations')
        .getPublicUrl(filePath);

      return publicUrl;
    },
    onError: (error) => {
      toast.error('Erreur lors de l\'upload');
      console.error(error);
    },
  });
}

export function useUploadThumbnail() {
  return useMutation({
    mutationFn: async ({ file, presentationId }: { file: File; presentationId: string }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${presentationId}.${fileExt}`;
      const filePath = `thumbnails/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('presentations')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('presentations')
        .getPublicUrl(filePath);

      return publicUrl;
    },
    onError: (error) => {
      toast.error('Erreur lors de l\'upload de la miniature');
      console.error(error);
    },
  });
}

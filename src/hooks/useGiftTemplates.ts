import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface GiftTemplate {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export function useGiftTemplates(activeOnly = true) {
  return useQuery({
    queryKey: ['gift-templates', activeOnly],
    queryFn: async () => {
      let query = supabase
        .from('gift_templates')
        .select('*')
        .order('display_order', { ascending: true });

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as GiftTemplate[];
    },
  });
}

export function useCreateGiftTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (template: { name: string; description?: string; image_url: string; display_order?: number }) => {
      const { data, error } = await supabase
        .from('gift_templates')
        .insert(template)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gift-templates'] });
      toast({ title: 'Template ajouté' });
    },
    onError: () => {
      toast({ title: 'Erreur', description: "Impossible d'ajouter le template.", variant: 'destructive' });
    },
  });
}

export function useUpdateGiftTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<GiftTemplate> }) => {
      const { error } = await supabase
        .from('gift_templates')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gift-templates'] });
    },
  });
}

export function useDeleteGiftTemplate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      // Get the template to find the image path
      const { data: template } = await supabase
        .from('gift_templates')
        .select('image_url')
        .eq('id', id)
        .single();

      // Delete from storage if image exists
      if (template?.image_url) {
        const url = new URL(template.image_url);
        const pathParts = url.pathname.split('/gift-templates/');
        if (pathParts[1]) {
          await supabase.storage.from('gift-templates').remove([decodeURIComponent(pathParts[1])]);
        }
      }

      const { error } = await supabase
        .from('gift_templates')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gift-templates'] });
      toast({ title: 'Template supprimé' });
    },
    onError: () => {
      toast({ title: 'Erreur', description: 'Impossible de supprimer.', variant: 'destructive' });
    },
  });
}

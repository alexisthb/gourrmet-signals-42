import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface GeneratedGift {
  id: string;
  signal_id: string;
  template_id: string;
  company_name: string;
  company_logo_url: string | null;
  original_image_url: string | null;
  generated_image_url: string | null;
  prompt_used: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function useGeneratedGifts(signalId: string) {
  return useQuery({
    queryKey: ['generated-gifts', signalId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('generated_gifts')
        .select('*')
        .eq('signal_id', signalId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as GeneratedGift[];
    },
    enabled: !!signalId,
  });
}

export function useGenerateGiftImage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ signalId, templateId, customPrompt }: { signalId: string; templateId: string; customPrompt?: string }) => {
      const { data, error } = await supabase.functions.invoke('generate-gift-image', {
        body: { signalId, templateId, customPrompt },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { generatedImageUrl: string; giftId: string };
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['generated-gifts', variables.signalId] });
      toast({
        title: '✅ Image générée',
        description: 'La photo personnalisée a été créée avec succès.',
      });
    },
    onError: (error: Error) => {
      const message = error.message.includes('Rate limit')
        ? 'Trop de requêtes. Réessayez dans quelques instants.'
        : error.message.includes('Payment')
        ? 'Crédits insuffisants. Ajoutez des crédits à votre espace.'
        : error.message;

      toast({
        title: 'Erreur de génération',
        description: message,
        variant: 'destructive',
      });
    },
  });
}

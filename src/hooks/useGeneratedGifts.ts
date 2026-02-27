import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useState, useEffect, useCallback, useRef } from 'react';

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
      return data as { giftId: string; status: string };
    },
    onSuccess: (data, variables) => {
      // Don't show success toast yet — the generation is still processing
      // The polling hook will handle the final toast
      toast({
        title: '🎨 Génération lancée',
        description: 'La personnalisation est en cours, cela peut prendre 1-2 minutes...',
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

// Poll for gift generation completion
export function useGiftGenerationPolling(signalId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pollingGiftIds, setPollingGiftIds] = useState<Set<string>>(new Set());
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const startPolling = useCallback((giftId: string) => {
    setPollingGiftIds(prev => new Set(prev).add(giftId));
  }, []);

  const stopPolling = useCallback((giftId: string) => {
    setPollingGiftIds(prev => {
      const next = new Set(prev);
      next.delete(giftId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (pollingGiftIds.size === 0) return;

    const interval = setInterval(async () => {
      for (const giftId of pollingGiftIds) {
        try {
          const { data, error } = await supabase
            .from('generated_gifts')
            .select('status, generated_image_url, error_message')
            .eq('id', giftId)
            .single();

          if (error) continue;

          if (data.status === 'completed') {
            stopPolling(giftId);
            queryClient.invalidateQueries({ queryKey: ['generated-gifts', signalId] });
            toastRef.current({
              title: '✅ Image générée',
              description: 'La photo personnalisée est prête !',
            });
          } else if (data.status === 'failed') {
            stopPolling(giftId);
            queryClient.invalidateQueries({ queryKey: ['generated-gifts', signalId] });
            toastRef.current({
              title: 'Échec de génération',
              description: data.error_message || 'Erreur inconnue',
              variant: 'destructive',
            });
          }
        } catch (err) {
          console.error('[Gift polling] Error:', err);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [pollingGiftIds, signalId, queryClient, stopPolling]);

  return { pollingGiftIds, startPolling, stopPolling };
}

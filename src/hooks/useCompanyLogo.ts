import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useFetchCompanyLogo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ signalId, companyName, sourceUrl, forceRetry, forceAI, manualDomain }: { signalId: string; companyName: string; sourceUrl?: string; forceRetry?: boolean; forceAI?: boolean; manualDomain?: string }) => {
      const { data, error } = await supabase.functions.invoke('fetch-company-logo', {
        body: { signalId, companyName, sourceUrl, forceRetry, forceAI, manualDomain },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { logoUrl?: string; source?: string; domain?: string; status?: string; manus_task_id?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signal'] });
      
      if (data.status === 'manus_processing') {
        // Manus async — don't show "logo found" toast
        return;
      }

      const sourceLabel = data.source?.startsWith('ai_') 
        ? `IA + ${data.source?.includes('clearbit') ? 'Clearbit' : 'Google'}` 
        : data.source === 'clearbit' ? 'Clearbit' : 'Google Favicon';
      toast({
        title: '✅ Logo récupéré',
        description: `Logo trouvé via ${sourceLabel} (${data.domain}).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Logo non trouvé',
        description: error.message === 'No logo found' 
          ? "Aucun logo trouvé. Essayez 'Forcer recherche IA' pour lancer Manus."
          : error.message,
        variant: 'destructive',
      });
    },
  });
}

// Hook for polling Manus logo task status
export function useLogoManusPolling(signalId: string | undefined) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isPolling, setIsPolling] = useState(false);
  const toastShownRef = useRef(false);

  const checkStatus = useCallback(async () => {
    if (!signalId) return;

    try {
      const { data, error } = await supabase.functions.invoke('check-logo-manus-status', {
        body: { signalId },
      });

      if (error) {
        console.error('[Logo polling] Error:', error);
        return;
      }

      if (data?.status === 'completed') {
        setIsPolling(false);
        queryClient.invalidateQueries({ queryKey: ['signal'] });
        if (data.logoUrl) {
          toast({
            title: '✅ Logo trouvé par Manus',
            description: 'Le logo a été récupéré et sauvegardé.',
          });
        } else {
          toast({
            title: 'Manus terminé',
            description: "Manus n'a pas trouvé de logo pour cette entreprise.",
            variant: 'destructive',
          });
        }
      }
    } catch (err) {
      console.error('[Logo polling] Error:', err);
    }
  }, [signalId, queryClient, toast]);

  const startPolling = useCallback(() => {
    setIsPolling(true);
    toastShownRef.current = false;
  }, []);

  useEffect(() => {
    if (!isPolling || !signalId) return;

    if (!toastShownRef.current) {
      toast({
        title: '🔍 Manus recherche le logo...',
        description: 'Cela peut prendre quelques minutes.',
      });
      toastShownRef.current = true;
    }

    // Check immediately, then every 10s
    checkStatus();
    const interval = setInterval(checkStatus, 10000);
    return () => clearInterval(interval);
  }, [isPolling, signalId, checkStatus, toast]);

  return { isPolling, startPolling, setIsPolling };
}

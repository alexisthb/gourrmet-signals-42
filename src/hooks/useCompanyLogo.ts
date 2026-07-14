import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useFetchCompanyLogo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ signalId, companyName, sourceUrl, forceRetry, manualDomain }: { signalId: string; companyName: string; sourceUrl?: string; forceRetry?: boolean; manualDomain?: string }) => {
      const { data, error } = await supabase.functions.invoke('fetch-company-logo', {
        body: { signalId, companyName, sourceUrl, forceRetry, manualDomain },
      });

      if (error) throw error;
      if (data?.status === 'not_found' || data?.fallback) {
        throw new Error(data.error || 'No logo found');
      }
      if (data?.error) throw new Error(data.error);
      return data as { logoUrl?: string; source?: string; domain?: string; status?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signal'] });

      const sourceLabel = data.source === 'clearbit' ? 'Clearbit' : 'Google Favicon';
      toast({
        title: '✅ Logo récupéré',
        description: `Logo trouvé via ${sourceLabel} (${data.domain}).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Logo non trouvé',
        description: error.message === 'No logo found'
          ? "Aucun logo trouvé. Essayez d'indiquer un domaine manuellement."
          : error.message,
        variant: 'destructive',
      });
    },
  });
}


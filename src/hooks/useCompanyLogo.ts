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
      if (data?.error) throw new Error(data.error);
      return data as { found?: boolean; logoUrl?: string; source?: string; domain?: string; message?: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signal'] });

      if (data.found === false || !data.logoUrl) {
        toast({
          title: 'Logo non trouvé',
          description: "Aucun logo trouvé automatiquement. Renseignez un domaine manuellement.",
        });
        return;
      }

      const sourceLabel = data.source === 'clearbit' ? 'Clearbit' : 'Google Favicon';
      toast({
        title: '✅ Logo récupéré',
        description: `Logo trouvé via ${sourceLabel} (${data.domain}).`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Erreur',
        description: error.message || "Une erreur est survenue lors de la récupération du logo.",
        variant: 'destructive',
      });
    },
  });
}


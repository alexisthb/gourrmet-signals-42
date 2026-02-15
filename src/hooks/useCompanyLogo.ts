import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useFetchCompanyLogo() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ signalId, companyName, sourceUrl }: { signalId: string; companyName: string; sourceUrl?: string }) => {
      const { data, error } = await supabase.functions.invoke('fetch-company-logo', {
        body: { signalId, companyName, sourceUrl },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { logoUrl: string; source: string; domain: string };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signal'] });
      toast({
        title: '✅ Logo récupéré',
        description: `Logo trouvé via ${data.source === 'clearbit' ? 'Clearbit' : 'Google Favicon'}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Logo non trouvé',
        description: error.message === 'No logo found' 
          ? "Aucun logo n'a pu être trouvé pour cette entreprise."
          : error.message,
        variant: 'destructive',
      });
    },
  });
}

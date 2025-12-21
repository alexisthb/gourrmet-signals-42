import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface EnrichmentResult {
  success: boolean;
  message: string;
  manus_task_id?: string;
  manus_task_url?: string;
  results?: any[];
}

export interface CheckResult {
  success: boolean;
  completed?: number;
  still_processing?: number;
  results?: any[];
}

// Enrichir un engager spécifique
export function useEnrichEngager() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (engagerId: string): Promise<EnrichmentResult> => {
      const { data, error } = await supabase.functions.invoke("enrich-linkedin-engager", {
        body: { engager_id: engagerId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-engagers"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      
      toast({
        title: "Enrichissement lancé",
        description: data.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Erreur lors de l'enrichissement",
        variant: "destructive",
      });
    },
  });
}

// Enrichir tous les engagers prospects en batch
export function useBatchEnrichEngagers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<EnrichmentResult> => {
      const { data, error } = await supabase.functions.invoke("enrich-linkedin-engager", {
        body: { batch: true },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-engagers"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      
      const tasksCount = data.results?.filter((r: any) => r.success).length || 0;
      toast({
        title: "Enrichissement batch lancé",
        description: `${tasksCount} enrichissements Manus démarrés`,
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Erreur lors de l'enrichissement batch",
        variant: "destructive",
      });
    },
  });
}

// Vérifier le statut des enrichissements en cours
export function useCheckEnrichmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (contactId?: string): Promise<CheckResult> => {
      const { data, error } = await supabase.functions.invoke("check-engager-enrichment", {
        body: contactId ? { contact_id: contactId } : { batch: true },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["linkedin-engagers"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      
      if (data.completed !== undefined) {
        toast({
          title: "Vérification terminée",
          description: `${data.completed} enrichissements complétés, ${data.still_processing} en cours`,
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: error instanceof Error ? error.message : "Erreur lors de la vérification",
        variant: "destructive",
      });
    },
  });
}

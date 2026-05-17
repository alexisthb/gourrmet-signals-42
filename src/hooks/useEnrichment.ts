import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCreateInteraction } from '@/hooks/useContactInteractions';

export interface CompanyEnrichment {
  id: string;
  signal_id: string;
  company_name: string;
  domain: string | null;
  website: string | null;
  linkedin_company_url: string | null;
  description: string | null;
  industry: string | null;
  employee_count: string | null;
  headquarters_location: string | null;
  founded_year: number | null;
  enrichment_source: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  raw_data?: {
    manus_task_id?: string;
    manus_task_url?: string;
  };
}

export interface Contact {
  id: string;
  enrichment_id: string;
  signal_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  department: string | null;
  location: string | null;
  email_principal: string | null;
  email_alternatif: string | null;
  phone: string | null;
  linkedin_url: string | null;
  is_priority_target: boolean;
  priority_score: number;
  outreach_status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// Hook pour récupérer l'enrichissement et les contacts d'un signal
export function useSignalEnrichment(signalId: string) {
  return useQuery({
    queryKey: ['signal-enrichment', signalId],
    queryFn: async () => {
      // Fetch enrichment
      const { data: enrichment, error: enrichmentError } = await supabase
        .from('company_enrichment')
        .select('*')
        .eq('signal_id', signalId)
        .maybeSingle();

      if (enrichmentError) throw enrichmentError;

      // Fetch contacts
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('*')
        .eq('signal_id', signalId)
        .order('priority_score', { ascending: false });

      if (contactsError) throw contactsError;

      return {
        enrichment: enrichment as CompanyEnrichment | null,
        contacts: (contacts || []) as Contact[],
      };
    },
    enabled: !!signalId,
  });
}

// Hook pour declencher l'enrichissement.
// GR-010: passe maintenant par la queue (enqueue-enrichment) au lieu d'appeler
// directement trigger-manus-enrichment. Permet de lancer plusieurs enrichissements
// en parallele sans saturer l'API Manus.
export function useTriggerEnrichment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (signalId: string) => {
      const response = await supabase.functions.invoke('enqueue-enrichment', {
        body: { signal_id: signalId, job_type: 'contacts' },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (_, signalId) => {
      queryClient.invalidateQueries({ queryKey: ['signal-enrichment', signalId] });
      queryClient.invalidateQueries({ queryKey: ['signal', signalId] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
      queryClient.invalidateQueries({ queryKey: ['enrichment-jobs'] });
    },
  });
}

// GR-010: lit les jobs d'enrichissement actifs pour un signal donne.
// Permet a l'UI de montrer un indicateur "en file d'attente" / "en cours" / "echec".
export function useEnrichmentJob(signalId: string | undefined) {
  return useQuery({
    queryKey: ['enrichment-jobs', signalId],
    enabled: !!signalId,
    refetchInterval: 5_000,
    queryFn: async () => {
      // Table enrichment_jobs ajoutee par migration recente, pas encore dans les types generes.
      const { data, error } = await ((supabase as any)
        .from('enrichment_jobs'))
        .select('*')
        .eq('signal_id', signalId)
        .order('queued_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as {
        id: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
        attempts: number;
        max_attempts: number;
        error_message: string | null;
        queued_at: string;
        started_at: string | null;
        finished_at: string | null;
      } | null;
    },
  });
}

// Hook pour vérifier le statut Manus
export function useCheckManusStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (signalId: string) => {
      const response = await supabase.functions.invoke('check-manus-status', {
        body: { signal_id: signalId },
      });

      if (response.error) throw response.error;
      return response.data as {
        status: string;
        contacts_count?: number;
        manus_task_id?: string;
        manus_task_url?: string;
        manus_status?: string;
        message?: string;
      };
    },
    onSuccess: (data, signalId) => {
      if (data.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['signal-enrichment', signalId] });
        queryClient.invalidateQueries({ queryKey: ['signal', signalId] });
        queryClient.invalidateQueries({ queryKey: ['signals'] });
      }
    },
  });
}

// Hook pour mettre à jour le statut d'un contact
export function useUpdateContactStatus() {
  const queryClient = useQueryClient();
  const createInteraction = useCreateInteraction();

  return useMutation({
    mutationFn: async ({ contactId, status, oldStatus }: { contactId: string; status: string; oldStatus?: string }) => {
      const { data, error } = await supabase
        .from('contacts')
        .update({ outreach_status: status })
        .eq('id', contactId)
        .select()
        .single();

      if (error) throw error;
      
      // Log the interaction if status changed
      if (oldStatus !== status) {
        try {
          await createInteraction.mutateAsync({
            contactId,
            actionType: 'status_change',
            oldValue: oldStatus || 'unknown',
            newValue: status,
          });
        } catch (e) {
          console.error('Error logging interaction:', e);
        }
      }
      
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['signal-enrichment', data.signal_id] });
      queryClient.invalidateQueries({ queryKey: ['all-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['contact-stats'] });
      queryClient.invalidateQueries({ queryKey: ['intervened-contacts'] });
    },
  });
}

// Hook pour obtenir le nombre de contacts par signal (pour la liste)
export function useSignalsWithContactCount() {
  return useQuery({
    queryKey: ['signals-contact-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('signals')
        .select(`
          id,
          enrichment_status,
          contacts:contacts(count)
        `);

      if (error) throw error;

      // Transform to a map for easy lookup
      const countMap: Record<string, { enrichment_status: string; contacts_count: number }> = {};
      data?.forEach((signal: any) => {
        countMap[signal.id] = {
          enrichment_status: signal.enrichment_status || 'none',
          contacts_count: signal.contacts?.[0]?.count || 0,
        };
      });

      return countMap;
    },
  });
}

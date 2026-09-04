import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { onMutationError } from '@/lib/mutation-errors';

/**
 * File « À identifier » (lot résolution société, 04/09).
 *
 * Quand la résolution LinkedIn d'une entreprise hésite (Arval BNP Paribas vs
 * ARVAL SARL D'ARCHITECTURE) ou ne trouve aucun bon candidat, réessayer paie
 * un run fournisseur pour retomber sur la même hésitation. La décision revient
 * à l'opératrice : elle épingle la bonne page LinkedIn (l'enrichissement
 * repart aussitôt, sans cooldown, et l'épinglage prime ensuite sur toute
 * recherche fournisseur) ou marque la fiche « non identifiable ».
 */

export interface IdentificationCandidate {
  name: string;
  linkedin_url: string | null;
  score: number;
  evidence: string[];
}

export interface PendingIdentification {
  signal_id: string;
  company_name: string;
  source_name: string | null;
  signal_type: string;
  score: number;
  event_detail: string | null;
  detected_at: string;
  resolution_status: 'ambiguous' | 'rejected';
  resolution_reason: string | null;
  error_message: string | null;
  failed_at: string;
  candidates: IdentificationCandidate[];
  previously_resolved_url: string | null;
  previously_resolved_name: string | null;
}

const PENDING_KEY = ['company-identifications-pending'];

// Vue et RPC trop récentes pour les types générés Supabase : cast local,
// à retirer quand Lovable aura régénéré integrations/supabase/types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingView = () => (supabase as any).from('company_identifications_pending');

export function usePendingIdentifications() {
  return useQuery({
    queryKey: PENDING_KEY,
    queryFn: async (): Promise<PendingIdentification[]> => {
      const { data, error } = await pendingView()
        .select('*')
        .order('failed_at', { ascending: false });
      if (error) throw error;
      return (data || []) as PendingIdentification[];
    },
  });
}

// Compteur du menu. Rafraîchi à la minute : la file bouge au rythme des
// enrichissements, pas au clic près.
export function usePendingIdentificationsCount() {
  return useQuery({
    queryKey: [...PENDING_KEY, 'count'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await pendingView()
        .select('signal_id', { count: 'exact', head: true });
      if (error) throw error;
      return count || 0;
    },
  });
}

// Le détail d'un signal affiche « Identification requise » à la place du
// réessai vain quand son échec est une question d'identité.
export function usePendingIdentificationForSignal(signalId: string | undefined) {
  return useQuery({
    queryKey: [...PENDING_KEY, signalId],
    enabled: !!signalId,
    queryFn: async (): Promise<PendingIdentification | null> => {
      const { data, error } = await pendingView()
        .select('*')
        .eq('signal_id', signalId)
        .maybeSingle();
      if (error) throw error;
      return (data as PendingIdentification) || null;
    },
  });
}

export interface ResolveIdentityInput {
  signalId: string;
  decision: 'pinned' | 'none_of_these';
  linkedinUrl?: string;
  chosenName?: string;
}

export interface ResolveIdentityResult {
  state: 'pinned' | 'marked_unidentifiable';
  resolution_id: string;
  relaunch?: { state?: string; reason?: string };
}

export function useResolveCompanyIdentity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      { signalId, decision, linkedinUrl, chosenName }: ResolveIdentityInput,
    ): Promise<ResolveIdentityResult> => {
      // L'acteur consigné est l'email connecté : une décision d'identité doit
      // rester attribuable des mois plus tard.
      const { data: userData } = await supabase.auth.getUser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC absente des types générés
      const { data, error } = await (supabase as any).rpc('resolve_company_identity', {
        p_signal_id: signalId,
        p_decision: decision,
        p_linkedin_url: linkedinUrl ?? null,
        p_chosen_name: chosenName ?? null,
        p_actor: userData?.user?.email || 'operatrice-ui',
      });
      if (error) throw error;
      return data as ResolveIdentityResult;
    },
    onSuccess: (_data, { signalId }) => {
      queryClient.invalidateQueries({ queryKey: PENDING_KEY });
      queryClient.invalidateQueries({ queryKey: ['signal-enrichment', signalId] });
      queryClient.invalidateQueries({ queryKey: ['enrichment-jobs', signalId] });
      queryClient.invalidateQueries({ queryKey: ['signal', signalId] });
      queryClient.invalidateQueries({ queryKey: ['signals'] });
    },
    onError: onMutationError('Décision non enregistrée'),
  });
}

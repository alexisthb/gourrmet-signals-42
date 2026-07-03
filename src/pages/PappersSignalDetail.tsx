import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingPage } from '@/components/LoadingSpinner';
import { supabase } from '@/integrations/supabase/client';
import { useTransferToSignals, type PappersSignal } from '@/hooks/usePappers';
import SignalDetail from './SignalDetail';

// Gestion d'un signal Pappers = EXACTEMENT la même interface que la Presse.
//
// L'interface de gestion (statut commercial, pipeline, notes, contacts, enrichissement
// Manus, logo, cadeau personnalisé, historique d'interactions) s'appuie techniquement sur
// une ligne `signals` (les contacts/enrichissements y sont rattachés par clé étrangère).
// On garantit donc de façon TRANSPARENTE (sans bouton « Transférer ») que le signal Pappers
// possède sa ligne `signals` liée, puis on rend exactement <SignalDetail> — qui affiche en
// plus une fiche Pappers (SIREN, compte à rebours anniversaire, effectif/CA) via
// PappersFicheCard lorsqu'il détecte une origine Pappers.
export default function PappersSignalDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { mutateAsync: transferToSignals } = useTransferToSignals({ silent: true });
  const transferStartedRef = useRef(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);

  const { data: signal, isLoading } = useQuery({
    queryKey: ['pappers-signal', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pappers_signals')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const runTransfer = useCallback(async (src: any) => {
    transferStartedRef.current = true;
    setTransferError(null);
    try {
      const pappersSignal = {
        ...(src as any),
        company_data: (src.company_data || {}) as Record<string, unknown>,
      } as PappersSignal;
      const newSignal = await transferToSignals(pappersSignal);
      setLinkedId(newSignal.id);
      queryClient.setQueryData(['pappers-signal', id], (old: any) =>
        old ? { ...old, signal_id: newSignal.id, transferred_to_signals: true, processed: true } : old);
    } catch (e) {
      transferStartedRef.current = false;
      setTransferError(e instanceof Error ? e.message : 'Erreur lors de la préparation de la fiche');
    }
  }, [transferToSignals, queryClient, id]);

  useEffect(() => {
    if (!signal) return;
    if (signal.signal_id) {
      setLinkedId(signal.signal_id);
      return;
    }
    if (transferStartedRef.current) return;
    runTransfer(signal);
  }, [signal, runTransfer]);

  if (isLoading) return <LoadingPage />;

  if (!signal) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Signal non trouvé</h2>
        <Link to="/pappers">
          <Button variant="link">Retour aux signaux Pappers</Button>
        </Link>
      </div>
    );
  }

  if (!linkedId) {
    if (transferError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center max-w-md mx-auto">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <div>
            <h2 className="text-lg font-semibold">Impossible de préparer la fiche</h2>
            <p className="text-sm text-muted-foreground mt-1">{transferError}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => runTransfer(signal)}>Réessayer</Button>
            <Link to="/pappers">
              <Button variant="outline">Retour</Button>
            </Link>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Préparation de la fiche…</p>
      </div>
    );
  }

  return <SignalDetail signalId={linkedId} />;
}

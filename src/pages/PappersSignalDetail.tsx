import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
  const { mutateAsync: transferToSignals } = useTransferToSignals({ silent: true });
  const transferStartedRef = useRef(false);
  const [linkedId, setLinkedId] = useState<string | null>(null);

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

  // Auto-transfert transparent : dès qu'on ouvre un signal Pappers non encore transféré, on
  // crée sa ligne `signals` liée pour activer la gestion. Idempotent (ref + flag signal_id).
  useEffect(() => {
    if (!signal) return;
    if (signal.signal_id) {
      setLinkedId(signal.signal_id);
      return;
    }
    if (transferStartedRef.current) return;
    transferStartedRef.current = true;
    (async () => {
      try {
        const pappersSignal = {
          ...(signal as any),
          company_data: (signal.company_data || {}) as Record<string, unknown>,
        } as PappersSignal;
        const newSignal = await transferToSignals(pappersSignal);
        setLinkedId(newSignal.id);
      } catch {
        // Erreur déjà notifiée par le hook ; on réautorise une tentative ultérieure.
        transferStartedRef.current = false;
      }
    })();
  }, [signal, transferToSignals]);

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

  // Transfert transparent en cours (première ouverture d'un signal non encore transféré).
  if (!linkedId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Préparation de la fiche…</p>
      </div>
    );
  }

  return <SignalDetail signalId={linkedId} />;
}

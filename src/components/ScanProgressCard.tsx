import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, XCircle, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';

interface ScanLog {
  id: string;
  status: string | null;
  articles_fetched: number | null;
  articles_analyzed: number | null;
  signals_created: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export function ScanProgressCard() {
  const queryClient = useQueryClient();
  const [activeScan, setActiveScan] = useState<ScanLog | null>(null);
  const [totalPending, setTotalPending] = useState<number>(0);
  // Refs pour éviter de redéclarer l'intervalle à chaque tick:
  //  - wasActive: true si on était en train de scanner (pour déclencher
  //    l'invalidation des queries quand le scan se termine)
  //  - errorCount: compteur d'erreurs consécutives pour backoff exponentiel
  const wasActiveRef = useRef(false);
  const errorCountRef = useRef(0);

  useEffect(() => {
    let timeoutId: number | undefined;

    // Polling avec try/catch + backoff exponentiel (avant: pas de gestion
    // d'erreur, l'effet pouvait crasher silencieusement et le polling se
    // poursuivait éternellement; en plus l'effet se recréait à chaque tick
    // car [activeScan] dans les deps -> double polling).
    const tick = async () => {
      try {
        const { data: scanLog, error } = await (supabase
          .from('scan_logs') as any)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (error) throw error;

        if (scanLog && (scanLog as ScanLog).status === 'running') {
          wasActiveRef.current = true;
          setActiveScan(scanLog as ScanLog);

          const { count } = await (supabase
            .from('raw_articles') as any)
            .select('*', { count: 'exact', head: true })
            .eq('processed', false);

          setTotalPending(count || 0);
        } else {
          if (wasActiveRef.current) {
            wasActiveRef.current = false;
            queryClient.invalidateQueries({ queryKey: ['signals'] });
            queryClient.invalidateQueries({ queryKey: ['signal-stats'] });
            queryClient.invalidateQueries({ queryKey: ['scan-logs'] });
            queryClient.invalidateQueries({ queryKey: ['pending-articles'] });
          }
          setActiveScan(null);
        }

        errorCountRef.current = 0;
        timeoutId = window.setTimeout(tick, 3000);
      } catch (err) {
        errorCountRef.current += 1;
        if (errorCountRef.current >= 5) {
          console.error('[ScanProgressCard] Polling stopped after 5 errors', err);
          return; // arrêt du polling
        }
        const delay = Math.min(30_000, 3000 * 2 ** (errorCountRef.current - 1));
        console.warn(`[ScanProgressCard] Poll error, retry in ${delay}ms`, err);
        timeoutId = window.setTimeout(tick, delay);
      }
    };

    tick();
    return () => { if (timeoutId !== undefined) clearTimeout(timeoutId); };
  }, [queryClient]);

  if (!activeScan) {
    return null;
  }

  const articlesAnalyzed = activeScan.articles_analyzed || 0;
  const signalsCreated = activeScan.signals_created || 0;
  
  // Calculate progress based on articles analyzed vs initial pending
  const initialPending = totalPending + articlesAnalyzed;
  const progressPercent = initialPending > 0 
    ? Math.round((articlesAnalyzed / initialPending) * 100)
    : 0;

  const currentBatch = Math.floor(articlesAnalyzed / 30) + 1;
  const totalBatches = Math.ceil(initialPending / 30);

  return (
    <div className="bg-primary/10 rounded-xl border border-primary/30 p-5 animate-pulse-slow">
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="h-5 w-5 text-primary animate-spin" />
        <h3 className="font-semibold text-foreground">Scan en cours</h3>
      </div>

      <div className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progression</span>
            <span className="font-medium text-primary">{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-background/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Activity className="h-3 w-3" />
              Batch actuel
            </div>
            <p className="text-lg font-bold text-foreground">
              {currentBatch} / {totalBatches}
            </p>
          </div>
          
          <div className="bg-background/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <CheckCircle className="h-3 w-3" />
              Articles analysés
            </div>
            <p className="text-lg font-bold text-foreground">{articlesAnalyzed}</p>
          </div>
        </div>

        {/* Signals found */}
        {signalsCreated > 0 && (
          <div className="flex items-center justify-between bg-success/10 rounded-lg p-3">
            <span className="text-sm text-muted-foreground">Signaux détectés</span>
            <span className="text-lg font-bold text-success">{signalsCreated}</span>
          </div>
        )}

        {/* Remaining info */}
        <p className="text-xs text-muted-foreground text-center">
          {totalPending} articles restants • Rafraîchissement auto toutes les 3s
        </p>
      </div>
    </div>
  );
}

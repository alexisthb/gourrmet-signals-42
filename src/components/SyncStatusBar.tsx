// GR-011 — Barre d'etat de synchronisation pour les pages Signaux.
// Affiche : derniere synchro / prochaine synchro + bouton "Synchroniser maintenant".

import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCronState } from '@/hooks/useCronState';
import { cn } from '@/lib/utils';

interface SyncStatusBarProps {
  jobName: string;
  onSyncNow?: () => void;
  syncInProgress?: boolean;
  className?: string;
}

export function SyncStatusBar({ jobName, onSyncNow, syncInProgress, className }: SyncStatusBarProps) {
  const { data: state, isLoading } = useCronState(jobName);

  if (isLoading || !state) {
    return null;
  }

  const StatusIcon =
    state.last_run_status === 'completed' ? CheckCircle2 :
    state.last_run_status === 'failed' ? AlertCircle :
    state.last_run_status === 'running' ? Loader2 :
    Clock;

  const statusColor =
    state.last_run_status === 'completed' ? 'text-emerald-600' :
    state.last_run_status === 'failed' ? 'text-destructive' :
    state.last_run_status === 'running' ? 'text-blue-600' :
    'text-muted-foreground';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIcon className={cn('h-4 w-4', statusColor, state.last_run_status === 'running' && 'animate-spin')} />
        <span className="text-muted-foreground">Dernière synchro :</span>
        <span className="font-medium">
          {state.last_run_at
            ? formatDistanceToNow(new Date(state.last_run_at), { addSuffix: true, locale: fr })
            : 'jamais'}
        </span>
      </div>

      {state.next_run_at && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>·</span>
          <Clock className="h-3.5 w-3.5" />
          <span>Prochaine :</span>
          <span className="font-medium text-foreground">
            {formatDistanceToNow(new Date(state.next_run_at), { addSuffix: true, locale: fr })}
          </span>
        </div>
      )}

      {state.last_error && (
        <div className="flex items-center gap-2 text-destructive text-xs px-2 py-1 rounded bg-destructive/10">
          <AlertCircle className="h-3 w-3" />
          {state.last_error.slice(0, 80)}
        </div>
      )}

      {onSyncNow && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSyncNow}
          disabled={syncInProgress || state.last_run_status === 'running'}
          className="ml-auto h-7 text-xs"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', syncInProgress && 'animate-spin')} />
          Synchroniser maintenant
        </Button>
      )}
    </div>
  );
}

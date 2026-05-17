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
    state.last_run_status === 'completed' ? 'text-success' :
    state.last_run_status === 'failed' ? 'text-danger' :
    state.last_run_status === 'running' ? 'text-indigo-600' :
    'text-fg-3';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-card bg-surface border border-border text-[13px]',
        className
      )}
    >
      <div className="flex items-center gap-2">
        <StatusIcon
          className={cn('h-4 w-4', statusColor, state.last_run_status === 'running' && 'animate-spin')}
          strokeWidth={1.8}
        />
        <span className="font-mono uppercase tracking-[0.14em] text-[10.5px] font-semibold text-fg-3">
          Dernière synchro
        </span>
        <span className="font-semibold text-navy-800">
          {state.last_run_at
            ? formatDistanceToNow(new Date(state.last_run_at), { addSuffix: true, locale: fr })
            : 'jamais'}
        </span>
      </div>

      {state.next_run_at && (
        <div className="flex items-center gap-2">
          <span className="text-fg-muted">·</span>
          <Clock className="h-3.5 w-3.5 text-fg-3" strokeWidth={1.8} />
          <span className="font-mono uppercase tracking-[0.14em] text-[10.5px] font-semibold text-fg-3">
            Prochaine
          </span>
          <span className="font-semibold text-navy-800">
            {formatDistanceToNow(new Date(state.next_run_at), { addSuffix: true, locale: fr })}
          </span>
        </div>
      )}

      {state.last_error && (
        <div className="flex items-center gap-1.5 text-danger text-[11.5px] font-semibold px-2.5 py-1 rounded-badge bg-danger-bg">
          <AlertCircle className="h-3 w-3" strokeWidth={1.8} />
          {state.last_error.slice(0, 80)}
        </div>
      )}

      {onSyncNow && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onSyncNow}
          disabled={syncInProgress || state.last_run_status === 'running'}
          className="ml-auto"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', syncInProgress && 'animate-spin')} strokeWidth={1.8} />
          Synchroniser maintenant
        </Button>
      )}
    </div>
  );
}

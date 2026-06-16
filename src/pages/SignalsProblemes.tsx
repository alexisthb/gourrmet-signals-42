import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useSignals } from '@/hooks/useSignals';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { SignalTypeBadge } from '@/components/SignalTypeBadge';
import { StatusBadge } from '@/components/StatusBadge';
import { SIGNAL_TYPE_CONFIG, type Signal } from '@/types/database';

/**
 * Page Problèmes - regroupe tous les signaux marqués "Problème" toutes sources confondues.
 * Permet à Clotilde de retrouver facilement les signaux à corriger / examiner.
 */
function getSignalRoute(signal: Signal): string {
  const source = signal.source_name || '';
  const type = signal.signal_type;
  if (source === 'Pappers' || ['anniversary', 'capital_increase', 'transfer', 'creation', 'radiation'].includes(type)) {
    return `/pappers/${signal.id}`;
  }
  return `/signals/${signal.id}`;
}

export default function SignalsProblemes() {
  const { data: signals, isLoading } = useSignals({
    status: 'probleme',
    period: 'all',
    minScore: 0,
  });

  const sorted = useMemo(
    () => [...(signals || [])].sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()),
    [signals],
  );

  if (isLoading) return <LoadingPage />;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-orange-600" strokeWidth={1.8} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-navy-800">Signaux à problème</h1>
            <p className="text-sm text-fg-3">
              {sorted.length} signal{sorted.length > 1 ? 'aux' : ''} marqué{sorted.length > 1 ? 's' : ''} comme problématique{sorted.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="Aucun signal à problème"
          description="Les signaux que vous marquerez avec le statut « Problème » apparaîtront ici."
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((signal) => {
            const typeConfig = SIGNAL_TYPE_CONFIG[signal.signal_type];
            return (
              <li key={signal.id}>
                <Link
                  to={getSignalRoute(signal)}
                  className="block bg-surface rounded-card border border-border p-5 transition-all hover:border-orange-300 hover:shadow-sm hover:-translate-y-[1px]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-base font-bold text-navy-800 truncate">{signal.company_name}</h3>
                        <SignalTypeBadge type={signal.signal_type} />
                      </div>
                      {signal.event_detail && (
                        <p className="text-sm text-fg-2 line-clamp-2 mb-2">{signal.event_detail}</p>
                      )}
                      <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-3">
                        <span>{typeConfig?.label || signal.signal_type}</span>
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}</span>
                        {signal.source_name && (
                          <>
                            <span>•</span>
                            <span>{signal.source_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <StatusBadge status={signal.status} />
                      <ExternalLink className="h-4 w-4 text-fg-3" />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

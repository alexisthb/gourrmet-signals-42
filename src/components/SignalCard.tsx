import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ExternalLink, Users, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ScoreStars } from './ScoreStars';
import { SignalTypeBadge } from './SignalTypeBadge';
import { StatusBadge } from './StatusBadge';
import type { Signal } from '@/types/database';

interface SignalCardProps {
  signal: Signal;
  className?: string;
  contactsCount?: number;
}

export function SignalCard({ signal, className, contactsCount }: SignalCardProps) {
  return (
    <Link to={`/signals/${signal.id}`} className="block">
      <div className={cn('signal-card animate-fade-in', className)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <ScoreStars score={signal.score} size="sm" />
              <StatusBadge status={signal.status} />
            </div>
            
            <h3 className="font-semibold text-foreground text-lg truncate">
              {signal.company_name}
            </h3>
            
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <SignalTypeBadge type={signal.signal_type} />
              {signal.sector && (
                <span className="text-xs px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
                  {signal.sector}
                </span>
              )}
              {signal.estimated_size && signal.estimated_size !== 'Inconnu' && (
                <span className="text-xs px-2 py-0.5 rounded-md border border-border text-muted-foreground">
                  {signal.estimated_size}
                </span>
              )}
              {/* Enrichment badges */}
              {signal.enrichment_status === 'completed' && contactsCount && contactsCount > 0 && (
                <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                  <Users className="h-3 w-3" />
                  {contactsCount} contact{contactsCount > 1 ? 's' : ''}
                </span>
              )}
              {signal.enrichment_status === 'completed' && signal.score >= 4 && (
                <span className="flex items-center gap-1 text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300 px-2 py-0.5 rounded-full" title="Enrichi automatiquement">
                  <Zap className="h-3 w-3" />
                  Auto
                </span>
              )}
              {signal.enrichment_status === 'processing' && (
                <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full animate-pulse">
                  ⏳ Enrichissement...
                </span>
              )}
            </div>

            {signal.event_detail && (
              <p className="text-sm text-muted-foreground mt-3 line-clamp-2">
                {signal.event_detail}
              </p>
            )}

            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              {signal.source_name && (
                <span className="flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  {signal.source_name}
                </span>
              )}
              <span>
                Détecté {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

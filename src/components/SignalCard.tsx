import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ExternalLink, Users, Zap, ArrowRight, Euro } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ScoreStars } from './ScoreStars';
import { SignalTypeBadge } from './SignalTypeBadge';
import { StatusBadge } from './StatusBadge';
import { formatRevenue } from '@/hooks/useRevenueSettings';
import type { Signal } from '@/types/database';

interface SignalCardProps {
  signal: Signal;
  className?: string;
  contactsCount?: number;
}

export function SignalCard({ signal, className, contactsCount }: SignalCardProps) {
  return (
    <Link to={`/signals/${signal.id}`} className="block group">
      <div className={cn(
        'bg-card rounded-3xl border border-border/30 p-6 transition-all duration-300',
        'hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 hover:-translate-y-1',
        'animate-fade-in',
        className
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-3">
              <ScoreStars score={signal.score} size="sm" />
              <StatusBadge status={signal.status} />
            </div>
            
            <h3 className="font-display font-bold text-foreground text-xl truncate group-hover:text-primary transition-colors">
              {signal.company_name}
            </h3>
            
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <SignalTypeBadge type={signal.signal_type} />
              {signal.sector && (
                <span className="text-xs px-3 py-1 rounded-full bg-muted text-muted-foreground font-medium">
                  {signal.sector}
                </span>
              )}
              {signal.estimated_size && signal.estimated_size !== 'Inconnu' && (
                <span className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground font-medium">
                  {signal.estimated_size}
                </span>
              )}
              {/* Revenue badge */}
              {signal.revenue && signal.revenue > 0 && (
                <span className="flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-semibold border border-emerald-200">
                  <Euro className="h-3 w-3" />
                  {formatRevenue(signal.revenue)}
                  {signal.revenue_source && (
                    <span className="text-emerald-500 ml-0.5 text-[10px]">
                      ({signal.revenue_source === 'perplexity' ? 'P' : signal.revenue_source === 'estimated' ? 'E' : signal.revenue_source.charAt(0).toUpperCase()})
                    </span>
                  )}
                </span>
              )}
              {/* Enrichment badges */}
              {signal.enrichment_status === 'completed' && contactsCount && contactsCount > 0 && (
                <span className="flex items-center gap-1.5 text-xs bg-secondary/10 text-secondary px-3 py-1 rounded-full font-semibold">
                  <Users className="h-3.5 w-3.5" />
                  {contactsCount} contact{contactsCount > 1 ? 's' : ''}
                </span>
              )}
              {signal.enrichment_status === 'completed' && signal.score >= 4 && (
                <span className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-3 py-1 rounded-full font-semibold" title="Enrichi automatiquement">
                  <Zap className="h-3.5 w-3.5" />
                  Auto
                </span>
              )}
              {signal.enrichment_status === 'processing' && (
                <span className="text-xs bg-accent/20 text-accent-foreground px-3 py-1 rounded-full font-semibold animate-pulse">
                  ⏳ Enrichissement...
                </span>
              )}
            </div>

            {signal.event_detail && (
              <p className="text-sm text-muted-foreground mt-4 line-clamp-2 leading-relaxed">
                {signal.event_detail}
              </p>
            )}

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {signal.source_name && (
                  <span className="flex items-center gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {signal.source_name}
                  </span>
                )}
                <span>
                  {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
              <div className="flex items-center text-primary font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                Voir détail
                <ArrowRight className="ml-1 h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

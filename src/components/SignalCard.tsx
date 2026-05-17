import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ExternalLink, Users, Zap, ArrowRight, Euro, Layers, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { ScoreStars } from './ScoreStars';
import { SignalTypeBadge } from './SignalTypeBadge';
import { StatusBadge } from './StatusBadge';
import { formatRevenue } from '@/hooks/useRevenueSettings';
import type { Signal } from '@/types/database';

/**
 * SignalCard - design Gourrmet (cf. handoff/CHECKLIST.md sec. 4 - "SignalCard").
 *
 * Layout 1fr_auto - corps a gauche, score + statut a droite.
 * Padding 22px, radius card 20px, border-border, hover indigo-200 + translate-y-[-1px].
 * Nom entreprise 16px navy-800 700, detail 13.5px text-fg-2 max 70ch.
 * Meta line en font-mono 11px text-fg-3 tracking-[0.04em].
 */
interface SignalCardProps {
  signal: Signal;
  className?: string;
  contactsCount?: number;
  /** GR-003: nombre total de signaux pour cette entreprise (>=1). Si >1, badge "+N signaux". */
  groupCount?: number;
  /** GR-003: true si l'entreprise a deja recu un mail / contact commercial. Affiche un warning. */
  alreadyContacted?: boolean;
}

export function SignalCard({ signal, className, contactsCount, groupCount, alreadyContacted }: SignalCardProps) {
  return (
    <Link to={`/signals/${signal.id}`} className="block group">
      <div
        className={cn(
          'grid grid-cols-[1fr_auto] gap-4 items-start bg-surface rounded-card border border-border p-[22px] transition-all duration-150 cursor-pointer',
          'hover:border-indigo-200 hover:shadow-sm hover:-translate-y-[1px]',
          className,
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <SignalTypeBadge type={signal.signal_type} />
            {groupCount && groupCount > 1 && (
              <span
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-badge border border-indigo-200"
                title={`Cette entreprise a ${groupCount} signaux detectes au total`}
              >
                <Layers className="h-3 w-3" strokeWidth={1.8} />
                +{groupCount - 1} signaux
              </span>
            )}
            {alreadyContacted && (
              <span
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-warning-bg text-warning px-2.5 py-1 rounded-badge"
                title="Cette entreprise a deja recu un email - attention au double envoi"
              >
                <Mail className="h-3 w-3" strokeWidth={1.8} />
                Déjà contactée
              </span>
            )}
            {signal.sector && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-fg-3 font-semibold px-2 py-0.5">
                {signal.sector}
              </span>
            )}
            {signal.estimated_size && signal.estimated_size !== 'Inconnu' && (
              <span className="text-[11.5px] font-medium text-fg-3 border border-border-strong px-2 py-0.5 rounded-md">
                {signal.estimated_size}
              </span>
            )}
            {signal.revenue && signal.revenue > 0 && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-success-bg text-success px-2.5 py-1 rounded-badge">
                <Euro className="h-3 w-3" strokeWidth={1.8} />
                {formatRevenue(signal.revenue)}
                {signal.revenue_source && (
                  <span className="text-success/70 ml-0.5 text-[9.5px]">
                    ({signal.revenue_source === 'perplexity' ? 'P' : signal.revenue_source === 'estimated' ? 'E' : signal.revenue_source.charAt(0).toUpperCase()})
                  </span>
                )}
              </span>
            )}
            {signal.enrichment_status === 'completed' && contactsCount && contactsCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-badge">
                <Users className="h-3 w-3" strokeWidth={1.8} />
                {contactsCount} contact{contactsCount > 1 ? 's' : ''}
              </span>
            )}
            {signal.enrichment_status === 'completed' && signal.score >= 4 && (
              <span
                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-badge"
                title="Enrichi automatiquement"
              >
                <Zap className="h-3 w-3" strokeWidth={1.8} />
                Auto
              </span>
            )}
            {(signal.enrichment_status === 'processing' || signal.enrichment_status === 'manus_processing') && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-indigo-600 font-semibold px-2 py-0.5 animate-pulse">
                {signal.enrichment_status === 'manus_processing' ? 'Manus en cours…' : 'Enrichissement…'}
              </span>
            )}
            {signal.enrichment_status === 'pending' && (
              <span
                className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-fg-3 font-semibold px-2 py-0.5 border border-border rounded-md"
                title="En file d'attente d'enrichissement"
              >
                En file
              </span>
            )}
            {signal.enrichment_status === 'failed' && (
              <span
                className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-danger-bg text-danger px-2.5 py-1 rounded-badge"
                title="Enrichissement echoue"
              >
                Échec
              </span>
            )}
          </div>

          <h3 className="font-bold text-navy-800 text-[16px] leading-snug tracking-[-0.01em] truncate group-hover:text-indigo-700 transition-colors">
            {signal.company_name}
          </h3>

          {signal.event_detail && (
            <p className="text-[13.5px] text-fg-2 mt-2 line-clamp-2 leading-[1.5] max-w-[70ch]">
              {signal.event_detail}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3 font-mono text-[11px] text-fg-3 tracking-[0.04em]">
            {signal.source_name && (
              <span className="inline-flex items-center gap-1.5">
                <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
                {signal.source_name}
              </span>
            )}
            <span>
              {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
            </span>
          </div>
        </div>

        {/* Aside : score + statut */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ScoreStars score={signal.score} size="sm" />
          <StatusBadge status={signal.status} />
          <div className="flex items-center text-indigo-600 font-semibold text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            Voir détail
            <ArrowRight className="ml-1 h-3.5 w-3.5" strokeWidth={1.8} />
          </div>
        </div>
      </div>
    </Link>
  );
}

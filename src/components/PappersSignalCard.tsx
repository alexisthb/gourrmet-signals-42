import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  MapPin,
  ArrowRight,
  ArrowUpRight,
  Cake,
  Users,
  Euro,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScoreStars } from './ScoreStars';
import { SignalTypeBadge } from './SignalTypeBadge';
import { StatusBadge } from './StatusBadge';
import { type SignalType, type SignalStatus } from '@/types/database';

/**
 * PappersSignalCard - design Gourrmet (cf. handoff/CHECKLIST.md sec. 4).
 *
 * Meme grille que SignalCard mais avec donnees Pappers (SIREN, effectif, CA).
 * Bouton "Transférer" en outline indigo pour les signaux non encore exportes.
 */

function getCompanyDataValue(companyData: unknown, key: string): string | number | null {
  if (typeof companyData === 'object' && companyData !== null && !Array.isArray(companyData)) {
    const obj = companyData as Record<string, unknown>;
    const value = obj[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
  }
  return null;
}

function formatCurrencyCompact(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1).replace('.', ',')}M€`;
  }
  if (amount >= 1000) {
    return `${Math.round(amount / 1000)}k€`;
  }
  return `${amount}€`;
}

interface PappersSignal {
  id: string;
  company_name: string;
  siren?: string | null;
  signal_type: string;
  signal_detail?: string | null;
  relevance_score?: number | null;
  company_data?: unknown;
  processed?: boolean | null;
  transferred_to_signals?: boolean | null;
  geo_zone_id?: string | null;
  detected_at?: string | null;
}

interface PappersSignalCardProps {
  signal: PappersSignal;
  className?: string;
  onTransfer?: () => void;
  isTransferring?: boolean;
}

export function PappersSignalCard({ signal, className, onTransfer, isTransferring }: PappersSignalCardProps) {
  const companyData = signal.company_data;

  const effectif = getCompanyDataValue(companyData, 'effectif');
  const chiffreAffaires = getCompanyDataValue(companyData, 'chiffre_affaires');
  const ville = getCompanyDataValue(companyData, 'ville');
  const anniversaryYears = getCompanyDataValue(companyData, 'anniversary_years');

  // relevance_score (0-100) -> etoiles (0-5)
  const starsScore = signal.relevance_score ? Math.round((signal.relevance_score / 100) * 5) : 0;
  const status: SignalStatus = signal.transferred_to_signals ? 'contacted' : 'new';

  return (
    <Link to={`/pappers/${signal.id}`} className="block group">
      <div
        className={cn(
          'grid grid-cols-[1fr_auto] gap-4 items-start bg-surface rounded-card border border-border p-[22px] transition-all duration-150 cursor-pointer animate-fade-in',
          'hover:border-indigo-200 hover:shadow-sm hover:-translate-y-[1px]',
          className,
        )}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <SignalTypeBadge type={signal.signal_type as SignalType} />
            {anniversaryYears && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold bg-source-pappers-bg text-source-pappers-foreground px-2.5 py-1 rounded-badge">
                <Cake className="h-3 w-3" strokeWidth={1.8} />
                {anniversaryYears} ans
              </span>
            )}
            {effectif && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-fg-3 border border-border-strong px-2 py-0.5 rounded-md">
                <Users className="h-3 w-3" strokeWidth={1.8} />
                {effectif} employés
              </span>
            )}
            {chiffreAffaires && Number(chiffreAffaires) > 0 && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-fg-3 border border-border-strong px-2 py-0.5 rounded-md">
                <Euro className="h-3 w-3" strokeWidth={1.8} />
                CA {formatCurrencyCompact(Number(chiffreAffaires))}
              </span>
            )}
            {signal.siren && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-3 font-semibold">
                SIREN {signal.siren}
              </span>
            )}
          </div>

          <h3 className="font-bold text-navy-800 text-[16px] leading-snug tracking-[-0.01em] truncate group-hover:text-indigo-700 transition-colors">
            {signal.company_name}
          </h3>

          {signal.signal_detail && (
            <p className="text-[13.5px] text-fg-2 mt-2 line-clamp-2 leading-[1.5] max-w-[70ch]">
              {signal.signal_detail}
            </p>
          )}

          <div className="flex items-center gap-4 mt-3 font-mono text-[11px] text-fg-3 tracking-[0.04em]">
            {ville && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3 w-3" strokeWidth={1.8} />
                {ville}
              </span>
            )}
            {signal.detected_at && (
              <span>
                {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
              </span>
            )}
          </div>
        </div>

        {/* Aside : score + statut + actions */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <ScoreStars score={starsScore} size="sm" />
          <StatusBadge status={status} />
          {!signal.transferred_to_signals && onTransfer && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11.5px] mt-1"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onTransfer();
              }}
              disabled={isTransferring}
            >
              <ArrowUpRight className="h-3 w-3 mr-1" strokeWidth={1.8} />
              Transférer
            </Button>
          )}
          <div className="flex items-center text-indigo-600 font-semibold text-xs opacity-0 group-hover:opacity-100 transition-opacity">
            Voir détail
            <ArrowRight className="ml-1 h-3.5 w-3.5" strokeWidth={1.8} />
          </div>
        </div>
      </div>
    </Link>
  );
}

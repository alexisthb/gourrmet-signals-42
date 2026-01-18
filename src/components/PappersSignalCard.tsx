import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  MapPin, 
  ArrowRight,
  ArrowUpRight,
  Cake
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScoreStars } from './ScoreStars';
import { SignalTypeBadge } from './SignalTypeBadge';
import { StatusBadge } from './StatusBadge';
import { type SignalType, type SignalStatus } from '@/types/database';

// Helper to safely access company_data properties
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

// Format currency compact
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
  
  // Extract data safely
  const effectif = getCompanyDataValue(companyData, 'effectif');
  const chiffreAffaires = getCompanyDataValue(companyData, 'chiffre_affaires');
  const ville = getCompanyDataValue(companyData, 'ville');
  const anniversaryYears = getCompanyDataValue(companyData, 'anniversary_years');
  
  // Convert relevance_score (0-100) to stars (0-5)
  const starsScore = signal.relevance_score ? Math.round((signal.relevance_score / 100) * 5) : 0;
  
  // Determine status based on processed/transferred
  const status: SignalStatus = signal.transferred_to_signals ? 'contacted' : 'new';

  return (
    <Link to={`/pappers/${signal.id}`} className="block group">
      <div className={cn(
        'bg-card rounded-3xl border border-border/30 p-6 transition-all duration-300',
        'hover:shadow-xl hover:shadow-secondary/5 hover:border-secondary/30 hover:-translate-y-1',
        'animate-fade-in',
        className
      )}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Score stars & Status */}
            <div className="flex items-center gap-3 mb-3">
              <ScoreStars score={starsScore} size="sm" />
              <StatusBadge status={status} />
            </div>
            
            {/* Company name */}
            <h3 className="font-display font-bold text-foreground text-xl truncate group-hover:text-secondary transition-colors">
              {signal.company_name}
            </h3>
            
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <SignalTypeBadge type={signal.signal_type as SignalType} />
              {anniversaryYears && (
                <span className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-secondary/10 text-secondary font-semibold">
                  <Cake className="h-3.5 w-3.5" />
                  {anniversaryYears} ans
                </span>
              )}
              {effectif && (
                <span className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground font-medium">
                  {effectif} employés
                </span>
              )}
              {chiffreAffaires && Number(chiffreAffaires) > 0 && (
                <span className="text-xs px-3 py-1 rounded-full border border-border text-muted-foreground font-medium">
                  CA {formatCurrencyCompact(Number(chiffreAffaires))}
                </span>
              )}
            </div>

            {/* Signal detail */}
            {signal.signal_detail && (
              <p className="text-sm text-muted-foreground mt-4 line-clamp-2 leading-relaxed">
                {signal.signal_detail}
              </p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {ville && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {ville}
                  </span>
                )}
                {signal.detected_at && (
                  <span>
                    {formatDistanceToNow(new Date(signal.detected_at), { addSuffix: true, locale: fr })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!signal.transferred_to_signals && onTransfer && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-7 px-2 text-xs text-secondary border-secondary/30 hover:bg-secondary/10"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTransfer();
                    }}
                    disabled={isTransferring}
                  >
                    <ArrowUpRight className="h-3 w-3 mr-1" />
                    Transférer
                  </Button>
                )}
                <div className="flex items-center text-secondary font-medium text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                  Voir détail
                  <ArrowRight className="ml-1 h-4 w-4" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

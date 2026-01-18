import { differenceInDays, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Building2, 
  Users, 
  Euro, 
  MapPin, 
  Timer, 
  ArrowRight,
  CheckCircle2,
  ArrowUpRight,
  Cake
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

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
  const config = SIGNAL_TYPE_CONFIG[signal.signal_type as SignalType] || SIGNAL_TYPE_CONFIG.creation;
  const companyData = signal.company_data;
  
  // Extract data safely
  const effectif = getCompanyDataValue(companyData, 'effectif');
  const chiffreAffaires = getCompanyDataValue(companyData, 'chiffre_affaires');
  const ville = getCompanyDataValue(companyData, 'ville');
  const anniversaryDate = getCompanyDataValue(companyData, 'anniversary_date');
  const anniversaryYears = getCompanyDataValue(companyData, 'anniversary_years');
  
  // Calculate days remaining dynamically
  const daysRemaining = anniversaryDate 
    ? differenceInDays(new Date(String(anniversaryDate)), new Date())
    : null;

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
            {/* Score & Badges */}
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary/10 border border-secondary/20">
                <span className="text-lg font-bold text-secondary">{signal.relevance_score}</span>
                <span className="text-xs text-muted-foreground">/100</span>
              </div>
              <Badge variant="outline" className="bg-secondary/10 text-secondary border-secondary/30">
                {config.emoji} {config.label}
              </Badge>
              {anniversaryYears && (
                <Badge className="bg-secondary text-secondary-foreground font-bold">
                  <Cake className="h-3 w-3 mr-1" />
                  {anniversaryYears} ans
                </Badge>
              )}
              {!signal.processed && (
                <Badge variant="secondary" className="text-xs">Nouveau</Badge>
              )}
              {signal.transferred_to_signals && (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Transféré
                </Badge>
              )}
            </div>
            
            {/* Company name */}
            <h3 className="font-display font-bold text-foreground text-xl truncate group-hover:text-secondary transition-colors">
              {signal.company_name}
            </h3>
            
            {/* Company metrics */}
            <div className="flex flex-wrap items-center gap-4 mt-3">
              {effectif && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 text-secondary/70" />
                  {effectif} employés
                </span>
              )}
              {chiffreAffaires && Number(chiffreAffaires) > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Euro className="h-4 w-4 text-secondary/70" />
                  {formatCurrencyCompact(Number(chiffreAffaires))}
                </span>
              )}
              {ville && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-secondary/70" />
                  {ville}
                </span>
              )}
            </div>

            {/* Footer with countdown and actions */}
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-border/50">
              <div className="flex items-center gap-4">
                {daysRemaining !== null && daysRemaining > 0 && (
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-secondary">
                    <Timer className="h-4 w-4" />
                    {daysRemaining} jours restants
                  </span>
                )}
                {anniversaryDate && (
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(String(anniversaryDate)), 'dd MMM yyyy', { locale: fr })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!signal.transferred_to_signals && onTransfer && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="h-8 px-3 text-secondary border-secondary/30 hover:bg-secondary/10"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTransfer();
                    }}
                    disabled={isTransferring}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
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

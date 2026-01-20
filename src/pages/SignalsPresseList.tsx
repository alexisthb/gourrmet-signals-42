import { useState, useEffect } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SignalCard } from '@/components/SignalCard';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { useSignals } from '@/hooks/useSignals';
import { useSignalsWithContactCount } from '@/hooks/useEnrichment';
import { SIGNAL_TYPE_CONFIG, STATUS_CONFIG, type SignalType, type SignalStatus } from '@/types/database';

export default function SignalsList() {
  const [filters, setFilters] = useState({
    minScore: 3,
    type: 'all' as SignalType | 'all',
    status: 'all' as SignalStatus | 'all',
    period: '30d' as '7d' | '30d' | '90d' | 'all',
    search: '',
  });
  
  // Debounced search state
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  
  // Debounce search input (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);
  
  const { data: signals, isLoading } = useSignals({
    minScore: filters.minScore,
    type: filters.type,
    status: filters.status,
    period: filters.period,
    search: debouncedSearch || undefined,
    excludeTypes: ['linkedin_engagement'],
    excludeSourceNames: ['LinkedIn', 'Pappers'],
  });

  const { data: contactCounts } = useSignalsWithContactCount();

  const resetFilters = () => {
    setFilters({
      minScore: 3,
      type: 'all',
      status: 'all',
      period: '30d',
      search: '',
    });
  };

  const hasActiveFilters = 
    filters.minScore !== 3 ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.period !== '30d' ||
    filters.search !== '';

  // Ne pas masquer le champ de recherche pendant les refetchs (garde la saisie fluide)
  if (isLoading && !signals) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Liste des signaux presse</h1>
        <p className="page-subtitle">
          {signals?.length || 0} signal{(signals?.length || 0) > 1 ? 'x' : ''} détecté{(signals?.length || 0) > 1 ? 's' : ''}
        </p>
      </div>

      {/* Filters */}
      <div className="filter-bar flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une entreprise..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              className="pl-10"
            />
          </div>
        </div>

        <Select
          value={String(filters.minScore)}
          onValueChange={(v) => setFilters({ ...filters, minScore: parseInt(v) })}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Score min" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Tous scores</SelectItem>
            <SelectItem value="3">Score ≥ 3</SelectItem>
            <SelectItem value="4">Score ≥ 4</SelectItem>
            <SelectItem value="5">Score 5</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.type}
          onValueChange={(v) => setFilters({ ...filters, type: v as SignalType | 'all' })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            {Object.entries(SIGNAL_TYPE_CONFIG)
              .filter(([key]) => key !== 'linkedin_engagement')
              .map(([key, config]) => (
                <SelectItem key={key} value={key}>
                  {config.emoji} {config.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => setFilters({ ...filters, status: v as SignalStatus | 'all' })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <SelectItem key={key} value={key}>
                {config.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.period}
          onValueChange={(v) => setFilters({ ...filters, period: v as typeof filters.period })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Période" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">7 derniers jours</SelectItem>
            <SelectItem value="30d">30 derniers jours</SelectItem>
            <SelectItem value="90d">3 mois</SelectItem>
            <SelectItem value="all">Tout</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="h-4 w-4 mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      {/* Signals List */}
      {signals && signals.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {signals.map((signal) => (
            <SignalCard 
              key={signal.id} 
              signal={signal}
              contactsCount={contactCounts?.[signal.id]?.contacts_count}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Filter}
          title="Aucun signal trouvé"
          description="Essayez de modifier vos filtres ou lancez un nouveau scan."
          action={
            hasActiveFilters && (
              <Button variant="outline" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            )
          }
        />
      )}
    </div>
  );
}

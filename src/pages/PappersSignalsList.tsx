import { useState } from 'react';
import { Search, Filter, X, Building2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { GeoFilter } from '@/components/GeoFilter';
import { PappersSignalCard } from '@/components/PappersSignalCard';
import { usePappersSignals, useTransferToSignals } from '@/hooks/usePappers';
import { usePersistedFilters } from '@/hooks/usePersistedFilters';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

const PAPPERS_SIGNAL_TYPES = [
  'anniversary',
  'capital_increase',
  'nomination',
  'transfer',
  'creation',
];

const DEFAULT_FILTERS = {
  minScore: 1,
  type: 'all' as string,
  status: 'all' as string,
  search: '',
};

export default function PappersSignalsList() {
  useScrollRestoration();
  const [filters, setFilters, resetAllFilters] = usePersistedFilters(DEFAULT_FILTERS);
  
  // Geo filters kept in local state (not URL-persisted for simplicity)
  const [selectedGeoZones, setSelectedGeoZones] = useState<string[]>([]);
  const [priorityOnly, setPriorityOnly] = useState(false);

  const { data: allSignals, isLoading } = usePappersSignals({});
  const transferToSignals = useTransferToSignals();

  const signals = allSignals?.filter(signal => {
    if (filters.search && !signal.company_name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    if (filters.type !== 'all' && signal.signal_type !== filters.type) {
      return false;
    }
    if (filters.status === 'new' && signal.transferred_to_signals) {
      return false;
    }
    if (filters.status === 'transferred' && !signal.transferred_to_signals) {
      return false;
    }
    if ((signal.relevance_score || 0) < filters.minScore) {
      return false;
    }
    if (selectedGeoZones.length > 0 && signal.geo_zone_id && !selectedGeoZones.includes(signal.geo_zone_id)) {
      return false;
    }
    return true;
  });

  const resetFilters = () => {
    resetAllFilters();
    setSelectedGeoZones([]);
    setPriorityOnly(false);
  };

  const hasActiveFilters = 
    filters.minScore !== 1 ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.search !== '' ||
    selectedGeoZones.length > 0;

  if (isLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Building2 className="h-6 w-6 text-source-pappers" />
          Liste des signaux Pappers
        </h1>
        <p className="page-subtitle">
          {signals?.length || 0} signal{(signals?.length || 0) > 1 ? 'x' : ''} détecté{(signals?.length || 0) > 1 ? 's' : ''}
        </p>
      </div>

      <div className="filter-bar flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher une entreprise..."
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              className="pl-10"
            />
          </div>
        </div>

        <GeoFilter
          selectedZones={selectedGeoZones}
          onZonesChange={setSelectedGeoZones}
          priorityOnly={priorityOnly}
          onPriorityOnlyChange={setPriorityOnly}
        />

        <Select
          value={String(filters.minScore)}
          onValueChange={(v) => setFilters({ minScore: parseInt(v) })}
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
          onValueChange={(v) => setFilters({ type: v })}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Type de signal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            {PAPPERS_SIGNAL_TYPES.map((type) => {
              const config = SIGNAL_TYPE_CONFIG[type];
              if (!config) return null;
              return (
                <SelectItem key={type} value={type}>
                  {config.emoji} {config.label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => setFilters({ status: v })}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous</SelectItem>
            <SelectItem value="new">Nouveaux</SelectItem>
            <SelectItem value="transferred">Transférés</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <X className="h-4 w-4 mr-1" />
            Réinitialiser
          </Button>
        )}
      </div>

      {signals && signals.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {signals.map((signal) => (
            <PappersSignalCard 
              key={signal.id} 
              signal={signal}
              onTransfer={() => transferToSignals.mutate(signal)}
              isTransferring={transferToSignals.isPending}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Filter}
          title="Aucun signal trouvé"
          description="Essayez de modifier vos filtres ou lancez un scan Pappers."
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, X, Building2, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { usePappersSignals, useTransferToSignals } from '@/hooks/usePappers';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

// Types spécifiques Pappers (utiliser string pour supporter les types dynamiques)
const PAPPERS_SIGNAL_TYPES = [
  'anniversary',
  'capital_increase',
  'nomination',
  'transfer',
  'creation',
];

export default function PappersSignalsList() {
  const [filters, setFilters] = useState({
    minScore: 1,
    type: 'all' as SignalType | 'all',
    status: 'all' as 'all' | 'new' | 'transferred',
    search: '',
  });
  
  // Filtres géographiques
  const [selectedGeoZones, setSelectedGeoZones] = useState<string[]>([]);
  const [priorityOnly, setPriorityOnly] = useState(false);

  const { data: allSignals, isLoading } = usePappersSignals({});
  const transferToSignals = useTransferToSignals();

  // Filtrage local
  const signals = allSignals?.filter(signal => {
    // Filtre par recherche
    if (filters.search && !signal.company_name.toLowerCase().includes(filters.search.toLowerCase())) {
      return false;
    }
    // Filtre par type
    if (filters.type !== 'all' && signal.signal_type !== filters.type) {
      return false;
    }
    // Filtre par statut
    if (filters.status === 'new' && signal.transferred_to_signals) {
      return false;
    }
    if (filters.status === 'transferred' && !signal.transferred_to_signals) {
      return false;
    }
    // Filtre par score
    if ((signal.relevance_score || 0) < filters.minScore) {
      return false;
    }
    // Filtre géographique
    if (selectedGeoZones.length > 0 && signal.geo_zone_id && !selectedGeoZones.includes(signal.geo_zone_id)) {
      return false;
    }
    return true;
  });

  const resetFilters = () => {
    setFilters({
      minScore: 1,
      type: 'all',
      status: 'all',
      search: '',
    });
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
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title flex items-center gap-2">
          <Building2 className="h-6 w-6 text-source-pappers" />
          Liste des signaux Pappers
        </h1>
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

        {/* Filtre géographique */}
        <GeoFilter
          selectedZones={selectedGeoZones}
          onZonesChange={setSelectedGeoZones}
          priorityOnly={priorityOnly}
          onPriorityOnlyChange={setPriorityOnly}
        />

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
          onValueChange={(v) => setFilters({ ...filters, status: v as typeof filters.status })}
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

      {/* Signals List */}
      {signals && signals.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {signals.map((signal) => {
            const config = SIGNAL_TYPE_CONFIG[signal.signal_type as SignalType] || SIGNAL_TYPE_CONFIG.creation;
            const companyData = signal.company_data || {};
            
            return (
              <Link key={signal.id} to={`/pappers/${signal.id}`}>
                <Card className="hover:border-source-pappers/30 transition-colors cursor-pointer hover:shadow-md h-full">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <Badge variant="outline" className="bg-source-pappers/10 text-source-pappers border-source-pappers/30">
                            {config.emoji} {config.label}
                          </Badge>
                          {!signal.processed && (
                            <Badge variant="secondary" className="text-xs">Nouveau</Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-foreground truncate text-sm">
                          {signal.company_name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {signal.signal_detail}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {(companyData.effectif || companyData.ville) && (
                            <span className="text-xs text-muted-foreground">
                              {companyData.effectif && <span>{companyData.effectif} emp.</span>}
                              {companyData.ville && <span> • {companyData.ville}</span>}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="text-lg font-bold text-source-pappers">
                          {signal.relevance_score}
                        </div>
                        {!signal.transferred_to_signals && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              transferToSignals.mutate(signal);
                            }}
                            disabled={transferToSignals.isPending}
                          >
                            <ArrowUpRight className="h-3 w-3" />
                          </Button>
                        )}
                        {signal.transferred_to_signals && (
                          <CheckCircle2 className="h-4 w-4 text-success" />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
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

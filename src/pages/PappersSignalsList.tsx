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
import {
  SIGNAL_TYPE_CONFIG,
  PIPELINE_STATUS_CONFIG,
  type SignalType,
  type PipelineStatus,
} from '@/types/database';
import { SignalTypeIcon } from '@/components/SignalTypeIcon';
import { cn } from '@/lib/utils';

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
  pipelineStatus: 'all' as string,
  search: '',
  sortBy: 'anniversary' as string, // 'anniversary' = anniversaire le plus proche en haut | 'recent'
};

// Pills pipeline identiques à la vue Presse (GR-008) — un signal Pappers non transféré
// (pas de ligne signals liée) est considéré "detected".
const PIPELINE_QUICK_FILTERS: { value: PipelineStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'detected', label: 'Détectés' },
  { value: 'drafted', label: 'En préparation' },
  { value: 'ready', label: 'Prêts à envoyer' },
  { value: 'sent', label: 'Envoyés' },
];

// Jours avant le prochain anniversaire (pour le tri). Anniversaire absent OU déjà passé ->
// +Infinity, donc relégué en fin de liste quand on trie par "anniversaire le plus proche".
function annivDays(s: any): number {
  const d = s?.company_data?.anniversary_date;
  const t = d ? new Date(d).getTime() : NaN;
  if (Number.isNaN(t)) return Infinity;
  const days = (t - Date.now()) / 86_400_000;
  return days < 0 ? Infinity : days;
}

export default function PappersSignalsList() {
  useScrollRestoration();
  const [filters, setFilters, resetAllFilters] = usePersistedFilters(DEFAULT_FILTERS);
  
  // Geo filters kept in local state (not URL-persisted for simplicity)
  const [selectedGeoZones, setSelectedGeoZones] = useState<string[]>([]);
  const [priorityOnly, setPriorityOnly] = useState(false);

  const { data: allSignals, isLoading } = usePappersSignals({});
  const transferToSignals = useTransferToSignals();

  const filtered = allSignals?.filter(signal => {
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
    // Le filtre est en ÉTOILES (1-5), or relevance_score est sur 0-100. On compare donc le
    // score converti en étoiles (MÊME calcul que PappersSignalCard), pas la valeur brute —
    // sinon "Score ≥ 4" ne retirait que relevance_score < 4 (quasi rien) et laissait passer
    // les signaux à 3★ (relevance_score ~50-69).
    const stars = signal.relevance_score ? Math.round((signal.relevance_score / 100) * 5) : 0;
    if (stars < filters.minScore) {
      return false;
    }
    if (selectedGeoZones.length > 0 && signal.geo_zone_id && !selectedGeoZones.includes(signal.geo_zone_id)) {
      return false;
    }
    // Filtre pipeline : signal transféré => on lit son pipeline_status (default 'detected'
    // si null en base) ; signal non transféré => considéré 'detected'.
    if (filters.pipelineStatus !== 'all') {
      const st = (signal as any).signal_status as string | null | undefined;
      // "Traité" côté commercial : une fois contacté / en relation / ignoré / perdu, le signal
      // sort de "Prêt à envoyer" (demande opératrice) — il n'est plus à envoyer en neuf.
      const acted = !!st && ['contacted', 'meeting', 'proposal', 'won', 'lost', 'ignored'].includes(st);
      const effectivePipeline = (signal as any).signal_pipeline_status || 'detected';
      if (filters.pipelineStatus === 'ready') {
        if (effectivePipeline !== 'ready' || acted) return false;
      } else if (effectivePipeline !== filters.pipelineStatus) {
        return false;
      }
    }
    return true;
  });

  // Tri : "anniversary" = anniversaire le plus proche en haut (demande opératrice), sinon
  // par détection la plus récente. Les dates absentes/passées finissent en bas (annivDays=∞).
  const signals = [...(filtered || [])].sort((a, b) =>
    filters.sortBy === 'anniversary'
      ? annivDays(a) - annivDays(b)
      : new Date(b.detected_at || 0).getTime() - new Date(a.detected_at || 0).getTime()
  );

  const resetFilters = () => {
    resetAllFilters();
    setSelectedGeoZones([]);
    setPriorityOnly(false);
  };

  const hasActiveFilters = 
    filters.minScore !== 1 ||
    filters.type !== 'all' ||
    filters.status !== 'all' ||
    filters.pipelineStatus !== 'all' ||
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

      {/* Pipeline pills (identique Presse) */}
      <div className="flex flex-wrap gap-2">
        {PIPELINE_QUICK_FILTERS.map((pill) => {
          const active = filters.pipelineStatus === pill.value;
          const cfg = pill.value !== 'all' ? PIPELINE_STATUS_CONFIG[pill.value as PipelineStatus] : null;
          return (
            <button
              key={pill.value}
              onClick={() => setFilters({ pipelineStatus: pill.value })}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                active
                  ? cfg
                    ? `${cfg.color} ring-2 ring-current ring-offset-1 ring-offset-background`
                    : 'bg-foreground text-background border-foreground'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {pill.label}
            </button>
          );
        })}
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
          value={filters.sortBy}
          onValueChange={(v) => setFilters({ sortBy: v })}
        >
          <SelectTrigger className="w-[210px]">
            <SelectValue placeholder="Trier par" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anniversary">Anniversaire le plus proche</SelectItem>
            <SelectItem value="recent">Détecté récemment</SelectItem>
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
              const config = SIGNAL_TYPE_CONFIG[type as SignalType];
              if (!config) return null;
              return (
                <SelectItem key={type} value={type}>
                  <span className="inline-flex items-center gap-2">
                    <SignalTypeIcon type={type as SignalType} className="h-3.5 w-3.5 text-indigo-600" />
                    {config.label}
                  </span>
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

import { Search, Filter, X, Linkedin, ThumbsUp, MessageSquare, Share2 } from 'lucide-react';
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
import { usePersistedFilters } from '@/hooks/usePersistedFilters';
import { useScrollRestoration } from '@/hooks/useScrollRestoration';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';

const DEFAULT_FILTERS = {
  minScore: 1,
  status: 'all' as string,
  period: '30d' as string,
  search: '',
  engagementType: 'all' as string,
};

export default function SignalsLinkedInList() {
  useScrollRestoration();
  const [filters, setFilters, resetFilters] = usePersistedFilters(DEFAULT_FILTERS);

  const { data: signals, isLoading } = useSignals({
    minScore: filters.minScore,
    type: 'linkedin_engagement',
    status: filters.status as SignalStatus | 'all',
    period: filters.period as '7d' | '30d' | '90d' | 'all',
    search: filters.search || undefined,
  });

  const { data: contactCounts } = useSignalsWithContactCount();

  const filteredSignals = signals?.filter(signal => {
    if (filters.engagementType === 'all') return true;
    const detail = signal.event_detail?.toLowerCase() || '';
    if (filters.engagementType === 'comment') return detail.includes('commentaire');
    if (filters.engagementType === 'like') return detail.includes('like');
    if (filters.engagementType === 'share') return detail.includes('partage');
    return true;
  });

  const hasActiveFilters = 
    filters.minScore !== 1 ||
    filters.status !== 'all' ||
    filters.period !== '30d' ||
    filters.search !== '' ||
    filters.engagementType !== 'all';

  const stats = {
    total: signals?.length || 0,
    comments: signals?.filter(s => s.event_detail?.toLowerCase().includes('commentaire')).length || 0,
    likes: signals?.filter(s => s.event_detail?.toLowerCase().includes('like')).length || 0,
    shares: signals?.filter(s => s.event_detail?.toLowerCase().includes('partage')).length || 0,
  };

  if (isLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600/10">
            <Linkedin className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h1 className="page-title">Signaux LinkedIn</h1>
            <p className="page-subtitle">
              {filteredSignals?.length || 0} engagement{(filteredSignals?.length || 0) > 1 ? 's' : ''} détecté{(filteredSignals?.length || 0) > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilters({ engagementType: 'all' })}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-600/10">
                <Linkedin className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total engagements</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilters({ engagementType: 'comment' })}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <MessageSquare className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.comments}</p>
                <p className="text-xs text-muted-foreground">Commentaires</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilters({ engagementType: 'like' })}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <ThumbsUp className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.likes}</p>
                <p className="text-xs text-muted-foreground">Likes</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setFilters({ engagementType: 'share' })}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/10">
                <Share2 className="h-5 w-5 text-cyan-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.shares}</p>
                <p className="text-xs text-muted-foreground">Partages</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un engager..."
              value={filters.search}
              onChange={(e) => setFilters({ search: e.target.value })}
              className="pl-10"
            />
          </div>
        </div>

        <Select
          value={filters.engagementType}
          onValueChange={(v) => setFilters({ engagementType: v })}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type d'engagement" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            <SelectItem value="comment">💬 Commentaires</SelectItem>
            <SelectItem value="like">👍 Likes</SelectItem>
            <SelectItem value="share">🔄 Partages</SelectItem>
          </SelectContent>
        </Select>

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
          value={filters.status}
          onValueChange={(v) => setFilters({ status: v })}
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
          onValueChange={(v) => setFilters({ period: v })}
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

      {filteredSignals && filteredSignals.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {filteredSignals.map((signal) => (
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
          title="Aucun signal LinkedIn trouvé"
          description="Essayez de modifier vos filtres ou lancez un nouveau scan LinkedIn."
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

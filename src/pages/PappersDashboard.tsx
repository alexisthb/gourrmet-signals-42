import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Building2, 
  TrendingUp,
  Calendar,
  Award,
  ArrowRight,
  Sparkles,
  Filter,
  ArrowUpRight,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingPage } from '@/components/LoadingSpinner';
import { usePappersSignals, usePappersStats, useTransferToSignals } from '@/hooks/usePappers';
import { usePappersScanProgress, useStartPappersScan } from '@/hooks/usePappersCredits';
import { PappersCreditAlert } from '@/components/PappersCreditAlert';
import { PappersScanProgress } from '@/components/PappersScanProgress';

const SIGNAL_TYPE_CONFIG: Record<string, { label: string; emoji: string }> = {
  anniversary: { label: 'Anniversaire', emoji: '🎂' },
  nomination: { label: 'Nomination', emoji: '👔' },
  capital_increase: { label: 'Levée de fonds', emoji: '💰' },
  transfer: { label: 'Déménagement', emoji: '📍' },
  creation: { label: 'Création', emoji: '🚀' },
};

export default function PappersDashboard() {
  const { data: signals, isLoading: signalsLoading } = usePappersSignals({ limit: 20 });
  const { data: stats, isLoading: statsLoading } = usePappersStats();
  const { data: scanProgress } = usePappersScanProgress();
  const startScan = useStartPappersScan();
  const transferToSignals = useTransferToSignals();

  if (signalsLoading || statsLoading) {
    return <LoadingPage />;
  }

  // Signaux récents (6 derniers)
  const recentSignals = signals?.slice(0, 6) || [];

  // Stats par type
  const signalsByType = signals?.reduce((acc, signal) => {
    const type = signal.signal_type || 'creation';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // Stats par statut
  const transferred = signals?.filter(s => s.transferred_to_signals).length || 0;
  const pending = signals?.filter(s => !s.processed).length || 0;

  // Dernier scan
  const lastScan = scanProgress?.[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-source-pappers" />
            Signaux Pappers
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détection de leads via l'API Pappers (anniversaires, nominations, levées...)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pappers/queries">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Requêtes
            </Button>
          </Link>
          <Button
            onClick={() => startScan.mutate({})}
            disabled={startScan.isPending}
            size="sm"
          >
            {startScan.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Lancer scan
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Alerte crédits */}
      <PappersCreditAlert />

      {/* Scan en cours */}
      <PappersScanProgress showControls={false} />

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total signaux"
          value={stats?.total || 0}
          icon={TrendingUp}
          iconColor="text-source-pappers"
        />
        <StatCard
          label="Cette semaine"
          value={stats?.anniversaries || 0}
          icon={Zap}
          iconColor="text-amber-500"
        />
        <StatCard
          label="À traiter"
          value={pending}
          icon={Sparkles}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Transférés"
          value={transferred}
          icon={Award}
          iconColor="text-violet-500"
        />
      </div>

      {/* Layout principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Signaux récents */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Signaux récents</h2>
            <Link to="/pappers/queries">
              <Button variant="ghost" size="sm" className="text-source-pappers">
                Tous <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {recentSignals.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recentSignals.map((signal) => {
                const config = SIGNAL_TYPE_CONFIG[signal.signal_type] || SIGNAL_TYPE_CONFIG.creation;
                const companyData = signal.company_data || {};
                
                return (
                  <Card key={signal.id} className="hover:border-source-pappers/30 transition-colors border-l-4 border-l-source-pappers">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
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
                          {(companyData.effectif || companyData.ville) && (
                            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                              {companyData.effectif && <span>{companyData.effectif} emp.</span>}
                              {companyData.ville && <span>• {companyData.ville}</span>}
                            </div>
                          )}
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
                              onClick={() => transferToSignals.mutate(signal)}
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
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="Aucun signal Pappers"
              description="Configurez vos requêtes et lancez un scan pour détecter des leads."
            />
          )}
        </div>

        {/* Colonne droite : Stats détaillées */}
        <div className="space-y-4">
          
          {/* Dernier scan */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Dernier scan
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lastScan ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Date</span>
                    <span className="text-sm font-medium">
                      {formatDistanceToNow(new Date(lastScan.started_at || lastScan.created_at), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Résultats traités</span>
                    <span className="text-sm font-medium">{lastScan.processed_results || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Progression</span>
                    <Badge variant="secondary">
                      {lastScan.current_page}/{lastScan.total_pages || '?'} pages
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {lastScan.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : lastScan.status === 'error' ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-source-pappers" />
                    )}
                    <span className="text-sm capitalize">{lastScan.status}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun scan effectué</p>
              )}
            </CardContent>
          </Card>

          {/* Répartition par type */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                Par type de signal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(SIGNAL_TYPE_CONFIG).map(([type, config]) => {
                const count = signalsByType[type] || 0;
                const total = signals?.length || 1;
                const percent = Math.round((count / total) * 100);
                return (
                  <div key={type} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span>{config.emoji}</span>
                        <span className="text-muted-foreground">{config.label}</span>
                      </span>
                      <span className="font-medium">{count}</span>
                    </div>
                    <Progress value={percent} className="h-1.5" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Statuts */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Par statut
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-3 bg-amber-500/10 rounded-lg">
                  <div className="text-xl font-bold text-amber-600">{pending}</div>
                  <div className="text-xs text-muted-foreground">À traiter</div>
                </div>
                <div className="text-center p-3 bg-source-pappers/10 rounded-lg">
                  <div className="text-xl font-bold text-source-pappers">{transferred}</div>
                  <div className="text-xs text-muted-foreground">Transférés</div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

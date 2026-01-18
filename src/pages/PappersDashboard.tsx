import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  Building2, 
  TrendingUp,
  Award,
  ArrowRight,
  Sparkles,
  Filter,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Loader2,
  Zap,
  Square,
  Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { EmptyState } from '@/components/EmptyState';
import { LoadingPage } from '@/components/LoadingSpinner';
import { PappersSignalCard } from '@/components/PappersSignalCard';
import { usePappersSignals, usePappersStats, useTransferToSignals } from '@/hooks/usePappers';
import { usePappersScanProgress, useStartPappersScan, useStopPappersScan } from '@/hooks/usePappersCredits';
import { PappersCreditAlert } from '@/components/PappersCreditAlert';
import { GenericScanProgressCard } from '@/components/GenericScanProgressCard';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';
import { useSettings } from '@/hooks/useSettings';

export default function PappersDashboard() {
  const { data: settings } = useSettings();
  const { data: signals, isLoading: signalsLoading } = usePappersSignals({ 
    limit: 20,
  });
  const { data: stats, isLoading: statsLoading } = usePappersStats();
  const { data: scanProgress } = usePappersScanProgress();
  const startScan = useStartPappersScan();
  const stopScan = useStopPappersScan();
  const transferToSignals = useTransferToSignals();

  // Scan actif
  const activeScan = scanProgress?.find(s => ['running', 'pending'].includes(s.status));

  // Calcul de la date d'anniversaire anticipée
  const anticipationMonths = parseInt(settings?.pappers_anticipation_months || '9') || 9;
  const futureAnniversaryDate = new Date();
  futureAnniversaryDate.setMonth(futureAnniversaryDate.getMonth() + anticipationMonths);

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
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span>
              Anniversaires du <strong>{futureAnniversaryDate.toLocaleDateString('fr-FR')}</strong> (dans {anticipationMonths} mois)
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/pappers/queries">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Requêtes
            </Button>
          </Link>
          {activeScan ? (
            <Button
              onClick={() => stopScan.mutate(activeScan.id)}
              disabled={stopScan.isPending}
              size="sm"
              variant="destructive"
            >
              {stopScan.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Arrêter scan
                </>
              )}
            </Button>
          ) : (
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
          )}
        </div>
      </div>


      {/* Scan en cours */}
      {activeScan && (
        <GenericScanProgressCard
          source="pappers"
          isActive={true}
          currentStep={activeScan.current_page || 1}
          totalSteps={activeScan.total_pages || 1}
          processedCount={activeScan.processed_results || 0}
          totalCount={activeScan.total_results || undefined}
          stepLabel="Page actuelle"
          processedLabel="Entreprises traitées"
          remainingLabel="entreprises restantes"
          resultsLabel="Signaux créés"
        />
      )}

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
            <Link to="/pappers/list">
              <Button variant="ghost" size="sm" className="text-source-pappers">
                Tous <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {recentSignals.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {recentSignals.map((signal) => (
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
              {/* Afficher uniquement les types Pappers */}
              {(['anniversary', 'capital_increase', 'nomination', 'transfer', 'creation'] as SignalType[]).map((type) => {
                const config = SIGNAL_TYPE_CONFIG[type];
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

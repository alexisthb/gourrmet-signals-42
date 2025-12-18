import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { TrendingUp, Sparkles, Clock, Target, RefreshCw, ArrowRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/StatCard';
import { SignalCard } from '@/components/SignalCard';
import { ScanProgressCard } from '@/components/ScanProgressCard';
import { LoadingSpinner, LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { useSignals, useSignalStats, usePendingArticlesCount } from '@/hooks/useSignals';
import { useScanLogs, useRunScan } from '@/hooks/useSettings';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const { toast } = useToast();
  const { data: stats, isLoading: statsLoading } = useSignalStats();
  const { data: signals, isLoading: signalsLoading } = useSignals({ minScore: 3 });
  const { data: scanLogs } = useScanLogs();
  const { data: pendingArticles } = usePendingArticlesCount();
  const runScan = useRunScan();

  const lastScan = scanLogs?.[0];
  const recentSignals = signals?.slice(0, 5) || [];

  const handleRunScan = async () => {
    toast({
      title: 'Scan en cours...',
      description: 'Récupération et analyse des actualités en cours.',
    });

    try {
      const result = await runScan.mutateAsync();
      toast({
        title: 'Scan terminé',
        description: `${result.fetch?.new_articles_saved || 0} articles collectés, ${result.analyze?.signals_created || 0} signaux détectés.`,
      });
    } catch (error) {
      toast({
        title: 'Erreur lors du scan',
        description: error instanceof Error ? error.message : 'Une erreur est survenue',
        variant: 'destructive',
      });
    }
  };

  if (statsLoading || signalsLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Vue d'ensemble de votre veille commerciale</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Signaux cette semaine"
          value={stats?.thisWeek || 0}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          label="Nouveaux signaux"
          value={stats?.new || 0}
          icon={Sparkles}
          iconColor="text-success"
        />
        <StatCard
          label="En cours"
          value={stats?.inProgress || 0}
          icon={Clock}
          iconColor="text-warning"
        />
        <StatCard
          label="Taux de conversion"
          value={`${stats?.conversionRate || 0}%`}
          icon={Target}
          iconColor="text-muted-foreground"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Signals */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Derniers signaux détectés</h2>
            <Link to="/signals">
              <Button variant="ghost" size="sm" className="text-primary">
                Voir tous <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {recentSignals.length > 0 ? (
            <div className="space-y-3">
              {recentSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun signal détecté"
              description="Lancez un scan pour détecter des opportunités commerciales."
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Scan Progress (shown when running) */}
          <ScanProgressCard />

          {/* Last Scan Card */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4">Dernier scan</h3>
            
            {lastScan ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Date</span>
                  <span className="font-medium">
                    {formatDistanceToNow(new Date(lastScan.started_at), { addSuffix: true, locale: fr })}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Statut</span>
                  <span className={`font-medium ${
                    lastScan.status === 'completed' ? 'text-success' : 
                    lastScan.status === 'failed' ? 'text-destructive' : 'text-warning'
                  }`}>
                    {lastScan.status === 'completed' ? 'Terminé' : 
                     lastScan.status === 'failed' ? 'Échoué' : 'En cours'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Articles</span>
                  <span className="font-medium">{lastScan.articles_fetched}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Signaux créés</span>
                  <span className="font-medium text-success">{lastScan.signals_created}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun scan effectué</p>
            )}

            <Button
              onClick={handleRunScan}
              disabled={runScan.isPending}
              className="w-full mt-4"
            >
              {runScan.isPending ? (
                <>
                  <LoadingSpinner size="sm" className="mr-2" />
                  Scan en cours...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Lancer un scan
                </>
              )}
            </Button>
          </div>

          {/* Quick Stats */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4">Statistiques</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total signaux</span>
                <span className="font-medium">{stats?.total || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">À traiter</span>
                <span className="font-medium text-success">{stats?.new || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">En prospection</span>
                <span className="font-medium text-warning">{stats?.inProgress || 0}</span>
              </div>
            </div>
          </div>

          {/* Pending Articles */}
          {pendingArticles !== undefined && pendingArticles > 0 && (
            <div className="bg-card rounded-xl border border-amber-500/30 p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-foreground">Articles en attente</h3>
              </div>
              <p className="text-2xl font-bold text-amber-500">{pendingArticles}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.ceil(pendingArticles / 30)} batch(s) restant(s)
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Le prochain scan traitera jusqu'à 300 articles
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

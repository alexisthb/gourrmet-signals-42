import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { 
  Radio, 
  TrendingUp, 
  Sparkles, 
  RefreshCw, 
  ArrowRight, 
  Loader2,
  Building2,
  Users,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertCircle,
  Filter,
  Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { SignalCard } from '@/components/SignalCard';
import { ScanProgressCard } from '@/components/ScanProgressCard';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { useSignals, useSignalStats } from '@/hooks/useSignals';
import { useScanLogs, useRunScan } from '@/hooks/useSettings';
import { useToast } from '@/hooks/use-toast';
import { SIGNAL_TYPE_CONFIG } from '@/types/database';

export default function SignalsPresseDashboard() {
  const { toast } = useToast();
  const { data: stats, isLoading: statsLoading } = useSignalStats();
  const { data: signals, isLoading: signalsLoading } = useSignals({ minScore: 1 });
  const { data: scanLogs } = useScanLogs();
  const runScan = useRunScan();

  const lastScan = scanLogs?.[0];
  const recentSignals = signals?.slice(0, 6) || [];

  const handleRunScan = async () => {
    try {
      await runScan.mutateAsync();
      toast({
        title: 'Scan lancé',
        description: 'L\'analyse des articles s\'exécute en arrière-plan.',
      });
    } catch (error) {
      toast({
        title: 'Erreur',
        description: error instanceof Error ? error.message : 'Une erreur est survenue',
        variant: 'destructive',
      });
    }
  };

  if (statsLoading || signalsLoading) {
    return <LoadingPage />;
  }

  // Calculer les stats par type
  const signalsByType = signals?.reduce((acc, signal) => {
    const type = signal.signal_type || 'autre';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // Stats par statut
  const signalsByStatus = signals?.reduce((acc, signal) => {
    const status = signal.status || 'new';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) || {};

  // Signaux avec enrichissement
  const enrichedCount = signals?.filter(s => s.enrichment_status === 'completed').length || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Signaux Presse
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Détection d'opportunités via l'analyse d'articles de presse
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/signals/list">
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Voir tous
            </Button>
          </Link>
          <Button
            onClick={handleRunScan}
            disabled={runScan.isPending}
            size="sm"
          >
            {runScan.isPending ? (
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

      {/* Scan en cours */}
      <ScanProgressCard />

      {/* KPIs principaux */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total signaux"
          value={stats?.total || 0}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          label="Cette semaine"
          value={stats?.thisWeek || 0}
          icon={Zap}
          iconColor="text-amber-500"
        />
        <StatCard
          label="À traiter"
          value={stats?.new || 0}
          icon={Sparkles}
          iconColor="text-blue-500"
        />
        <StatCard
          label="Enrichis"
          value={enrichedCount}
          icon={Building2}
          iconColor="text-violet-500"
        />
      </div>

      {/* Layout principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Signaux récents */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Signaux récents</h2>
            <Link to="/signals/list">
              <Button variant="ghost" size="sm" className="text-primary">
                Tous <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          {recentSignals.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {recentSignals.map((signal) => (
                <SignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Aucun signal"
              description="Lancez un scan pour détecter des opportunités."
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
                      {formatDistanceToNow(new Date(lastScan.started_at), { addSuffix: true, locale: fr })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Articles analysés</span>
                    <span className="text-sm font-medium">{lastScan.articles_analyzed || 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Signaux créés</span>
                    <Badge variant="secondary">{lastScan.signals_created || 0}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {lastScan.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    ) : lastScan.status === 'failed' ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
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
                const percent = stats?.total ? Math.round((count / stats.total) * 100) : 0;
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
                <Users className="h-4 w-4 text-muted-foreground" />
                Par statut
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-3 bg-amber-500/10 rounded-lg">
                  <div className="text-xl font-bold text-amber-600">{signalsByStatus['new'] || 0}</div>
                  <div className="text-xs text-muted-foreground">Nouveaux</div>
                </div>
                <div className="text-center p-3 bg-blue-500/10 rounded-lg">
                  <div className="text-xl font-bold text-blue-600">{signalsByStatus['qualified'] || 0}</div>
                  <div className="text-xs text-muted-foreground">Qualifiés</div>
                </div>
                <div className="text-center p-3 bg-emerald-500/10 rounded-lg">
                  <div className="text-xl font-bold text-emerald-600">{signalsByStatus['contacted'] || 0}</div>
                  <div className="text-xs text-muted-foreground">Contactés</div>
                </div>
                <div className="text-center p-3 bg-violet-500/10 rounded-lg">
                  <div className="text-xl font-bold text-violet-600">{signalsByStatus['converted'] || 0}</div>
                  <div className="text-xs text-muted-foreground">Convertis</div>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}

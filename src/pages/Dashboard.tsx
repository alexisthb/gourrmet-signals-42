import { useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  TrendingUp, 
  Sparkles, 
  Clock, 
  Target, 
  RefreshCw, 
  ArrowRight, 
  FileText, 
  Users, 
  Loader2,
  Building2,
  CheckCircle2,
  Zap,
  BarChart3,
  Activity
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { SignalCard } from '@/components/SignalCard';
import { ScanProgressCard } from '@/components/ScanProgressCard';
import { LoadingSpinner, LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { EnrichmentProgressModal } from '@/components/EnrichmentProgressModal';
import { useSignals, useSignalStats, usePendingArticlesCount } from '@/hooks/useSignals';
import { useScanLogs, useRunScan } from '@/hooks/useSettings';
import { useEnrichmentNotifications, useEnrichmentProgressStats } from '@/hooks/useEnrichmentNotifications';
import { useContactStats } from '@/hooks/useContacts';
import { useToast } from '@/hooks/use-toast';

export default function Dashboard() {
  const [enrichmentModalOpen, setEnrichmentModalOpen] = useState(false);
  const { toast } = useToast();
  const { data: stats, isLoading: statsLoading } = useSignalStats();
  const { data: signals, isLoading: signalsLoading } = useSignals({ minScore: 3 });
  const { data: scanLogs } = useScanLogs();
  const { data: pendingArticles } = usePendingArticlesCount();
  const { data: enrichmentStats } = useEnrichmentProgressStats();
  const { data: contactStats } = useContactStats();
  const runScan = useRunScan();

  // Enable enrichment notifications globally
  useEnrichmentNotifications();

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

  const enrichmentProgressPercent = enrichmentStats?.total_enrichments 
    ? Math.round((enrichmentStats.completed / enrichmentStats.total_enrichments) * 100)
    : 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Dashboard</h1>
            <p className="page-subtitle">Vue d'ensemble de votre veille commerciale</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            Mise à jour en temps réel
          </div>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
          label="En prospection"
          value={stats?.inProgress || 0}
          icon={Clock}
          iconColor="text-warning"
        />
        <div onClick={() => setEnrichmentModalOpen(true)} className="cursor-pointer">
          <StatCard
            label="Enrichissements en cours"
            value={enrichmentStats?.processing || 0}
            icon={Loader2}
            iconColor="text-violet-500"
          />
        </div>
        <Link to="/contacts">
          <StatCard
            label="Contacts extraits"
            value={contactStats?.total || 0}
            icon={Users}
            iconColor="text-emerald-500"
          />
        </Link>
        <StatCard
          label="Taux de conversion"
          value={`${stats?.conversionRate || 0}%`}
          icon={Target}
          iconColor="text-muted-foreground"
        />
      </div>

      {/* Enrichment Progress Banner */}
      {(enrichmentStats?.processing ?? 0) > 0 && (
        <div 
          onClick={() => setEnrichmentModalOpen(true)}
          className="bg-gradient-to-r from-violet-500/10 via-primary/5 to-violet-500/10 border border-violet-500/20 rounded-xl p-4 cursor-pointer hover:border-violet-500/40 transition-colors"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/20">
                <Activity className="h-5 w-5 text-violet-500 animate-pulse" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Enrichissement Manus en cours</h3>
                <p className="text-sm text-muted-foreground">
                  {enrichmentStats?.processing} entreprise(s) en analyse • {enrichmentStats?.completed} terminée(s)
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-violet-500">{enrichmentStats?.total_contacts}</div>
              <div className="text-xs text-muted-foreground">contacts trouvés</div>
            </div>
          </div>
          <Progress value={enrichmentProgressPercent} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{enrichmentProgressPercent}% terminé</span>
            <span>~{enrichmentStats?.avg_contacts || 0} contacts/entreprise en moyenne</span>
          </div>
        </div>
      )}

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

          {/* Real-time Activity */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-foreground">Activité temps réel</h3>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  Enrichis aujourd'hui
                </span>
                <span className="font-medium text-success">{enrichmentStats?.completed_today || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Users className="h-3 w-3 text-emerald-500" />
                  Contacts aujourd'hui
                </span>
                <span className="font-medium text-emerald-500">{enrichmentStats?.contacts_today || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 text-violet-500" />
                  En traitement
                </span>
                <span className="font-medium text-violet-500">{enrichmentStats?.processing || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-2">
                  <BarChart3 className="h-3 w-3" />
                  Moy. contacts/entreprise
                </span>
                <span className="font-medium">{enrichmentStats?.avg_contacts || 0}</span>
              </div>
            </div>
          </div>

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

          {/* Pipeline Stats */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="font-semibold text-foreground mb-4">Pipeline contacts</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total contacts</span>
                <span className="font-bold text-lg">{contactStats?.total || 0}</span>
              </div>
              <div className="h-px bg-border" />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Nouveaux</span>
                <span className="font-medium text-blue-500">{contactStats?.new || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">LinkedIn envoyé</span>
                <span className="font-medium text-sky-500">{contactStats?.linkedin_sent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email envoyé</span>
                <span className="font-medium text-amber-500">{contactStats?.email_sent || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">A répondu</span>
                <span className="font-medium text-violet-500">{contactStats?.responded || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">RDV planifié</span>
                <span className="font-medium text-emerald-500">{contactStats?.meeting || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Convertis</span>
                <span className="font-medium text-success">{contactStats?.converted || 0}</span>
              </div>
            </div>
            <Link to="/contacts" className="block mt-4">
              <Button variant="outline" size="sm" className="w-full">
                <Users className="mr-2 h-4 w-4" />
                Voir les contacts
              </Button>
            </Link>
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

      {/* Enrichment Progress Modal */}
      <EnrichmentProgressModal 
        open={enrichmentModalOpen} 
        onOpenChange={setEnrichmentModalOpen} 
      />
    </div>
  );
}

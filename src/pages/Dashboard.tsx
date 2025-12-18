import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  TrendingUp, 
  Sparkles, 
  Target, 
  RefreshCw, 
  ArrowRight, 
  Users, 
  Loader2,
  CheckCircle2,
  Activity,
  Mail,
  MessageSquare,
  Calendar,
  Trophy,
  Building2,
  Zap
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { StatCard } from '@/components/StatCard';
import { SignalCard } from '@/components/SignalCard';
import { ScanProgressCard } from '@/components/ScanProgressCard';
import { LoadingPage } from '@/components/LoadingSpinner';
import { EmptyState } from '@/components/EmptyState';
import { EnrichmentProgressModal } from '@/components/EnrichmentProgressModal';
import { useSignals, useSignalStats } from '@/hooks/useSignals';
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
  const { data: enrichmentStats } = useEnrichmentProgressStats();
  const { data: contactStats } = useContactStats();
  const runScan = useRunScan();

  // Enable enrichment notifications globally
  useEnrichmentNotifications();

  const lastScan = scanLogs?.[0];
  const recentSignals = signals?.slice(0, 4) || [];

  const handleRunScan = async () => {
    toast({
      title: 'Scan en cours...',
      description: 'Récupération et analyse des actualités.',
    });

    try {
      const result = await runScan.mutateAsync();
      toast({
        title: 'Scan terminé',
        description: `${result.fetch?.new_articles_saved || 0} articles, ${result.analyze?.signals_created || 0} signaux.`,
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

  const enrichmentProgressPercent = enrichmentStats?.total_enrichments 
    ? Math.round((enrichmentStats.completed / enrichmentStats.total_enrichments) * 100)
    : 0;

  const hasEnrichmentInProgress = (enrichmentStats?.processing ?? 0) > 0;

  // Calculate pipeline conversion funnel
  const totalContacts = contactStats?.total || 0;
  const contactedCount = (contactStats?.linkedin_sent || 0) + (contactStats?.email_sent || 0);
  const respondedCount = contactStats?.responded || 0;
  const meetingCount = contactStats?.meeting || 0;
  const convertedCount = contactStats?.converted || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header compact */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {lastScan ? `Dernier scan ${formatDistanceToNow(new Date(lastScan.started_at), { addSuffix: true, locale: fr })}` : 'Aucun scan récent'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5 bg-muted/50 rounded-full">
            <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
            Temps réel
          </div>
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
                Scanner
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Scan Progress (if running) */}
      <ScanProgressCard />

      {/* Enrichment Banner (if active) */}
      {hasEnrichmentInProgress && (
        <div 
          onClick={() => setEnrichmentModalOpen(true)}
          className="bg-gradient-to-r from-violet-500/10 via-primary/5 to-violet-500/10 border border-violet-500/20 rounded-xl p-4 cursor-pointer hover:border-violet-500/40 transition-all"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/20">
                <Activity className="h-5 w-5 text-violet-500 animate-pulse" />
              </div>
              <div>
                <div className="font-semibold text-foreground">Manus enrichit {enrichmentStats?.processing} entreprise(s)</div>
                <div className="text-sm text-muted-foreground">
                  {enrichmentStats?.total_contacts || 0} contacts trouvés • {enrichmentProgressPercent}% terminé
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" className="text-violet-600 border-violet-300">
              Détails
            </Button>
          </div>
          <Progress value={enrichmentProgressPercent} className="h-1.5 mt-3" />
        </div>
      )}

      {/* KPIs principaux - 2 rangées */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Signaux cette semaine"
          value={stats?.thisWeek || 0}
          icon={TrendingUp}
          iconColor="text-primary"
        />
        <StatCard
          label="À traiter"
          value={stats?.new || 0}
          icon={Sparkles}
          iconColor="text-amber-500"
        />
        <div onClick={() => setEnrichmentModalOpen(true)} className="cursor-pointer">
          <StatCard
            label="Enrichis"
            value={stats?.enriched || 0}
            icon={Building2}
            iconColor="text-violet-500"
          />
        </div>
        <Link to="/contacts">
          <StatCard
            label="Contacts"
            value={totalContacts}
            icon={Users}
            iconColor="text-emerald-500"
          />
        </Link>
      </div>

      {/* Layout principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Colonne gauche : Signaux récents */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground">Signaux récents</h2>
            <Link to="/signals">
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

        {/* Colonne droite : Pipeline & Stats */}
        <div className="space-y-4">
          
          {/* Pipeline de prospection */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Pipeline</h3>
              <Link to="/contacts">
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  Voir tout
                </Button>
              </Link>
            </div>
            
            {/* Funnel visuel */}
            <div className="space-y-2">
              <PipelineRow 
                icon={Users} 
                label="Contacts" 
                value={totalContacts}
                color="text-muted-foreground"
                percent={100}
              />
              <PipelineRow 
                icon={MessageSquare} 
                label="Contactés" 
                value={contactedCount}
                color="text-blue-500"
                percent={totalContacts > 0 ? (contactedCount / totalContacts) * 100 : 0}
              />
              <PipelineRow 
                icon={Mail} 
                label="Ont répondu" 
                value={respondedCount}
                color="text-violet-500"
                percent={totalContacts > 0 ? (respondedCount / totalContacts) * 100 : 0}
              />
              <PipelineRow 
                icon={Calendar} 
                label="RDV" 
                value={meetingCount}
                color="text-emerald-500"
                percent={totalContacts > 0 ? (meetingCount / totalContacts) * 100 : 0}
              />
              <PipelineRow 
                icon={Trophy} 
                label="Gagnés" 
                value={convertedCount}
                color="text-success"
                percent={totalContacts > 0 ? (convertedCount / totalContacts) * 100 : 0}
              />
            </div>

            {/* Taux de conversion */}
            {totalContacts > 0 && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Taux de conversion</span>
                  <span className="text-lg font-bold text-primary">
                    {stats?.conversionRate || 0}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Activité temps réel */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-foreground">Aujourd'hui</h3>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <div className="text-2xl font-bold text-violet-500">{enrichmentStats?.completed_today || 0}</div>
                <div className="text-xs text-muted-foreground">enrichissements</div>
              </div>
              <div className="text-center p-3 bg-muted/30 rounded-lg">
                <div className="text-2xl font-bold text-emerald-500">{enrichmentStats?.contacts_today || 0}</div>
                <div className="text-xs text-muted-foreground">contacts</div>
              </div>
            </div>
            
            {enrichmentStats?.avg_contacts && enrichmentStats.avg_contacts > 0 && (
              <div className="mt-3 text-center text-xs text-muted-foreground">
                Moyenne : {enrichmentStats.avg_contacts} contacts / entreprise
              </div>
            )}
          </div>

          {/* Actions rapides */}
          <div className="bg-gradient-to-br from-primary/5 to-primary/10 rounded-xl border border-primary/20 p-5">
            <h3 className="font-semibold text-foreground mb-3">Actions</h3>
            <div className="space-y-2">
              <Link to="/signals?status=new" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Sparkles className="h-4 w-4 mr-2 text-amber-500" />
                  {stats?.new || 0} signaux à traiter
                </Button>
              </Link>
              <Link to="/contacts?status=new" className="block">
                <Button variant="outline" size="sm" className="w-full justify-start">
                  <Users className="h-4 w-4 mr-2 text-blue-500" />
                  {contactStats?.new || 0} contacts à prospecter
                </Button>
              </Link>
            </div>
          </div>

        </div>
      </div>

      {/* Modal enrichissement */}
      <EnrichmentProgressModal 
        open={enrichmentModalOpen} 
        onOpenChange={setEnrichmentModalOpen} 
      />
    </div>
  );
}

// Composant pour une ligne du pipeline
function PipelineRow({ 
  icon: Icon, 
  label, 
  value, 
  color,
  percent 
}: { 
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  percent: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className={`h-4 w-4 ${color} flex-shrink-0`} />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={`text-sm font-medium ${color}`}>{value}</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all ${
              color === 'text-muted-foreground' ? 'bg-muted-foreground/30' :
              color === 'text-blue-500' ? 'bg-blue-500' :
              color === 'text-violet-500' ? 'bg-violet-500' :
              color === 'text-emerald-500' ? 'bg-emerald-500' :
              'bg-success'
            }`}
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

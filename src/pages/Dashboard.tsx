import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  ArrowRight, 
  Users, 
  Mail,
  MessageSquare,
  Calendar,
  Trophy,
  Building2,
  Zap,
  Radio,
  Newspaper,
  Search,
  MapPin,
  Cpu,
  FileSearch,
  AlertTriangle,
  TrendingUp,
  Target,
  BarChart3
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingPage } from '@/components/LoadingSpinner';
import { useSignals, useSignalStats } from '@/hooks/useSignals';
import { useScanLogs } from '@/hooks/useSettings';
import { useEnrichmentNotifications, useEnrichmentProgressStats } from '@/hooks/useEnrichmentNotifications';
import { useContactStats } from '@/hooks/useContacts';
import { usePappersStats } from '@/hooks/usePappers';
import { useEngagers } from '@/hooks/useEngagers';
import { useEvents } from '@/hooks/useEvents';
import { useManusCreditsSummary } from '@/hooks/useManusCredits';
import { useApifyCreditsSummary } from '@/hooks/useApifyCredits';
import { usePappersCreditsSummary } from '@/hooks/usePappersCredits';

export default function Dashboard() {
  const { data: presseStats, isLoading: statsLoading } = useSignalStats();
  const { data: signals, isLoading: signalsLoading } = useSignals({ minScore: 3 });
  const { data: scanLogs } = useScanLogs();
  const { data: enrichmentStats } = useEnrichmentProgressStats();
  const { data: contactStats } = useContactStats();
  const { data: pappersStats } = usePappersStats();
  const { data: engagers } = useEngagers();
  const { data: events } = useEvents();
  
  // Credits summaries
  const manusCredits = useManusCreditsSummary();
  const apifyCredits = useApifyCreditsSummary();
  const pappersCredits = usePappersCreditsSummary();

  // Enable enrichment notifications globally
  useEnrichmentNotifications();

  const lastScan = scanLogs?.[0];

  if (statsLoading || signalsLoading) {
    return <LoadingPage />;
  }

  // ========== CALCULS GLOBAUX (toutes sources) ==========
  
  // Signaux totaux (toutes sources)
  const totalSignalsPresse = presseStats?.total || 0;
  const totalSignalsPappers = pappersStats?.total || 0;
  const totalSignalsLinkedIn = engagers?.length || 0;
  const totalSignauxGlobal = totalSignalsPresse + totalSignalsPappers + totalSignalsLinkedIn;
  
  // Signaux nouveaux/à traiter
  const newSignalsPresse = presseStats?.new || 0;
  const newSignalsPappers = pappersStats?.pending || 0;
  const prospectsLinkedIn = engagers?.filter(e => e.is_prospect).length || 0;
  const totalNouveaux = newSignalsPresse + newSignalsPappers + prospectsLinkedIn;

  // Contacts globaux (toutes sources)
  const contactsFromSignals = contactStats?.total || 0;
  const contactsFromEvents = events?.reduce((sum, e) => sum + (e.contacts_count || 0), 0) || 0;
  const totalContactsGlobal = contactsFromSignals + contactsFromEvents;

  // Pipeline global (contacts de toutes sources)
  const contactedCount = (contactStats?.linkedin_sent || 0) + (contactStats?.email_sent || 0);
  const respondedCount = contactStats?.responded || 0;
  const meetingCount = contactStats?.meeting || 0;
  const convertedCount = contactStats?.converted || 0;

  // Calcul taux de conversion global
  const conversionRate = totalContactsGlobal > 0 
    ? Math.round((convertedCount / totalContactsGlobal) * 100) 
    : 0;

  // Events stats
  const upcomingEvents = events?.filter(e => new Date(e.date_start) > new Date()).length || 0;

  // Activité aujourd'hui
  const enrichmentsToday = enrichmentStats?.completed_today || 0;
  const contactsToday = enrichmentStats?.contacts_today || 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard Global</h1>
          <p className="text-sm text-muted-foreground">
            {lastScan ? `Dernière activité ${formatDistanceToNow(new Date(lastScan.started_at), { addSuffix: true, locale: fr })}` : 'Vue d\'ensemble de votre veille commerciale'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-3 py-1.5 bg-muted/50 rounded-full">
          <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
          Temps réel
        </div>
      </div>

      {/* ============ KPIs GLOBAUX ============ */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground">{totalSignauxGlobal}</div>
                <div className="text-xs text-muted-foreground">Signaux totaux</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs">
              <Badge variant="outline" className="text-amber-600 border-amber-300">
                {totalNouveaux} à traiter
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <Users className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground">{totalContactsGlobal}</div>
                <div className="text-xs text-muted-foreground">Contacts enrichis</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs">
              <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                +{contactStats?.new || 0} cette semaine
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-violet-500/20">
                <TrendingUp className="h-5 w-5 text-violet-500" />
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground">{conversionRate}%</div>
                <div className="text-xs text-muted-foreground">Taux conversion</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs">
              <Badge variant="outline" className="text-violet-600 border-violet-300">
                {convertedCount} gagnés
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/20">
                <Zap className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground">{enrichmentsToday + contactsToday}</div>
                <div className="text-xs text-muted-foreground">Actions aujourd'hui</div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              {enrichmentsToday} enrichissements • {contactsToday} contacts
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ============ SOURCES DE SIGNAUX ============ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-1 w-1 rounded-full bg-primary" />
          <h2 className="text-lg font-semibold text-foreground">Sources de signaux</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Presse */}
          <Link to="/signals" className="block">
            <Card className="h-full hover:border-primary/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
                  <Radio className="h-4 w-4 text-primary" />
                  Signaux Presse
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold text-foreground">{totalSignalsPresse}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <span className="text-amber-500 font-medium">{newSignalsPresse}</span> nouveaux
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    +{presseStats?.thisWeek || 0} /sem
                  </Badge>
                </div>
                <Progress 
                  value={totalSignauxGlobal > 0 ? (totalSignalsPresse / totalSignauxGlobal) * 100 : 0} 
                  className="h-1 mt-3" 
                />
              </CardContent>
            </Card>
          </Link>

          {/* Pappers */}
          <Link to="/pappers" className="block">
            <Card className="h-full hover:border-violet-500/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
                  <Building2 className="h-4 w-4 text-violet-500" />
                  Signaux Pappers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold text-foreground">{totalSignalsPappers}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      <span className="text-violet-500 font-medium">{newSignalsPappers}</span> en attente
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant="outline" className="text-xs border-amber-200 text-amber-700">
                      🎂 {pappersStats?.anniversaries || 0}
                    </Badge>
                  </div>
                </div>
                <Progress 
                  value={totalSignauxGlobal > 0 ? (totalSignalsPappers / totalSignauxGlobal) * 100 : 0} 
                  className="h-1 mt-3 [&>div]:bg-violet-500" 
                />
              </CardContent>
            </Card>
          </Link>

          {/* LinkedIn */}
          <Link to="/engagers" className="block">
            <Card className="h-full hover:border-blue-500/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
                  <Newspaper className="h-4 w-4 text-blue-500" />
                  Signaux LinkedIn
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-bold text-foreground">{totalSignalsLinkedIn}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      engagements collectés
                    </div>
                  </div>
                  <Badge className="text-xs bg-emerald-500">
                    {prospectsLinkedIn} prospects
                  </Badge>
                </div>
                <Progress 
                  value={totalSignauxGlobal > 0 ? (totalSignalsLinkedIn / totalSignauxGlobal) * 100 : 0} 
                  className="h-1 mt-3 [&>div]:bg-blue-500" 
                />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* ============ PIPELINE & ÉVÉNEMENTS ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Pipeline Global */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-foreground">Pipeline Global</h2>
            </div>
            <Link to="/contacts">
              <Button variant="ghost" size="sm" className="text-primary">
                Voir contacts <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
          </div>

          <Card>
            <CardContent className="pt-6">
              {/* Résumé sources */}
              <div className="grid grid-cols-3 gap-4 mb-6 pb-6 border-b border-border">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Presse</div>
                  <div className="text-lg font-bold text-primary">{contactsFromSignals}</div>
                  <div className="text-xs text-muted-foreground">contacts</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">Événements</div>
                  <div className="text-lg font-bold text-emerald-500">{contactsFromEvents}</div>
                  <div className="text-xs text-muted-foreground">contacts</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-1">LinkedIn</div>
                  <div className="text-lg font-bold text-blue-500">{prospectsLinkedIn}</div>
                  <div className="text-xs text-muted-foreground">prospects</div>
                </div>
              </div>

              {/* Funnel visuel */}
              <div className="space-y-3">
                <PipelineRow 
                  icon={Users} 
                  label="Contacts totaux" 
                  value={totalContactsGlobal}
                  color="text-muted-foreground"
                  percent={100}
                />
                <PipelineRow 
                  icon={MessageSquare} 
                  label="Contactés" 
                  value={contactedCount}
                  color="text-blue-500"
                  percent={totalContactsGlobal > 0 ? (contactedCount / totalContactsGlobal) * 100 : 0}
                />
                <PipelineRow 
                  icon={Mail} 
                  label="Ont répondu" 
                  value={respondedCount}
                  color="text-violet-500"
                  percent={totalContactsGlobal > 0 ? (respondedCount / totalContactsGlobal) * 100 : 0}
                />
                <PipelineRow 
                  icon={Calendar} 
                  label="RDV obtenus" 
                  value={meetingCount}
                  color="text-emerald-500"
                  percent={totalContactsGlobal > 0 ? (meetingCount / totalContactsGlobal) * 100 : 0}
                />
                <PipelineRow 
                  icon={Trophy} 
                  label="Convertis" 
                  value={convertedCount}
                  color="text-success"
                  percent={totalContactsGlobal > 0 ? (convertedCount / totalContactsGlobal) * 100 : 0}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Colonne droite */}
        <div className="space-y-4">
          {/* Événements */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Calendar className="h-4 w-4 text-emerald-500" />
                Événements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between mb-3">
                <div>
                  <div className="text-2xl font-bold text-foreground">{events?.length || 0}</div>
                  <div className="text-xs text-muted-foreground">suivis</div>
                </div>
                <Badge className="text-xs bg-emerald-500">
                  {upcomingEvents} à venir
                </Badge>
              </div>
              {events && events.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground pt-3 border-t border-border">
                  <MapPin className="h-3 w-3" />
                  <span className="truncate">
                    {events.find(e => new Date(e.date_start) > new Date())?.name || 'Aucun à venir'}
                  </span>
                </div>
              )}
              <Link to="/events" className="block mt-3">
                <Button variant="outline" size="sm" className="w-full">
                  Voir le calendrier
                </Button>
              </Link>
            </CardContent>
          </Card>

          {/* Scanner Événements */}
          <Link to="/events/scanner" className="block">
            <Card className="hover:border-cyan-500/50 transition-colors cursor-pointer group">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground group-hover:text-foreground">
                  <Search className="h-4 w-4 text-cyan-500" />
                  Scanner Événements
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Détectez salons et conférences pertinents
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>

      {/* ============ CONSOMMATION API ============ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-1 w-1 rounded-full bg-amber-500" />
            <h2 className="text-lg font-semibold text-foreground">Consommation API</h2>
          </div>
          <Link to="/settings/api">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              Configurer
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CreditCardBlock 
            title="Manus"
            icon={Cpu}
            iconColor="text-violet-500"
            used={manusCredits.used}
            limit={manusCredits.limit}
            percent={manusCredits.percent}
            isWarning={manusCredits.isWarning}
            isCritical={manusCredits.isCritical}
            link="/settings/api"
          />

          <CreditCardBlock 
            title="Apify"
            icon={Newspaper}
            iconColor="text-blue-500"
            used={apifyCredits.used}
            limit={apifyCredits.limit}
            percent={apifyCredits.percent}
            isWarning={apifyCredits.isWarning}
            isCritical={apifyCredits.isCritical}
            link="/settings/api"
          />

          <CreditCardBlock 
            title="Pappers"
            icon={FileSearch}
            iconColor="text-emerald-500"
            used={pappersCredits.used}
            limit={pappersCredits.limit}
            percent={pappersCredits.percent}
            isWarning={pappersCredits.isWarning}
            isCritical={pappersCredits.isCritical}
            link="/settings/api"
          />
        </div>
      </div>
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
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
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

// Composant pour afficher une carte de crédit API
function CreditCardBlock({ 
  title, 
  icon: Icon, 
  iconColor,
  used,
  limit,
  percent,
  isWarning,
  isCritical,
  link
}: { 
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  used: number;
  limit: number;
  percent: number;
  isWarning: boolean;
  isCritical: boolean;
  link: string;
}) {
  const getBorderColor = () => {
    if (isCritical) return 'border-destructive/50 hover:border-destructive';
    if (isWarning) return 'border-amber-500/50 hover:border-amber-500';
    return 'hover:border-primary/50';
  };

  return (
    <Link to={link} className="block">
      <Card className={`h-full transition-colors cursor-pointer group ${getBorderColor()}`}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground group-hover:text-foreground">
              <Icon className={`h-4 w-4 ${iconColor}`} />
              {title}
            </span>
            {isCritical && <AlertTriangle className="h-4 w-4 text-destructive" />}
          </div>
          <div className="flex items-end justify-between mb-2">
            <span className="text-xl font-bold text-foreground">{used.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">/ {limit.toLocaleString()}</span>
          </div>
          <Progress 
            value={Math.min(percent, 100)} 
            className={`h-1.5 ${isCritical ? '[&>div]:bg-destructive' : isWarning ? '[&>div]:bg-amber-500' : ''}`}
          />
        </CardContent>
      </Card>
    </Link>
  );
}

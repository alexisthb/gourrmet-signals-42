import { useMemo } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { 
  History, Newspaper, Building2, Linkedin, CheckCircle, XCircle, 
  Loader2, AlertCircle, Clock, FileText, Users, TrendingUp
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useScanLogs } from '@/hooks/useSettings';
import { usePappersScanProgress } from '@/hooks/usePappersCredits';
import { useLinkedInScanProgress } from '@/hooks/useLinkedInSources';
import { cn } from '@/lib/utils';

type ScanSource = 'presse' | 'pappers' | 'linkedin';

interface UnifiedScanEntry {
  id: string;
  source: ScanSource;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
  stats: {
    label: string;
    value: number | null;
  }[];
  details?: string;
}

const SOURCE_CONFIG: Record<ScanSource, { label: string; icon: typeof Newspaper; color: string; bgColor: string }> = {
  presse: { 
    label: 'Presse', 
    icon: Newspaper, 
    color: 'text-primary',
    bgColor: 'bg-primary/10'
  },
  pappers: { 
    label: 'Pappers', 
    icon: Building2, 
    color: 'text-secondary',
    bgColor: 'bg-secondary/10'
  },
  linkedin: { 
    label: 'LinkedIn', 
    icon: Linkedin, 
    color: 'text-accent',
    bgColor: 'bg-accent/10'
  },
};

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; className: string }> = {
  completed: { label: 'Terminé', icon: CheckCircle, className: 'text-emerald-600 bg-emerald-100' },
  running: { label: 'En cours', icon: Loader2, className: 'text-blue-600 bg-blue-100' },
  pending: { label: 'En attente', icon: Clock, className: 'text-amber-600 bg-amber-100' },
  failed: { label: 'Échec', icon: XCircle, className: 'text-red-600 bg-red-100' },
  error: { label: 'Erreur', icon: XCircle, className: 'text-red-600 bg-red-100' },
  cancelled: { label: 'Annulé', icon: AlertCircle, className: 'text-gray-600 bg-gray-100' },
  manus_processing: { label: 'Traitement Manus', icon: Loader2, className: 'text-purple-600 bg-purple-100' },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const isAnimated = status === 'running' || status === 'pending' || status === 'manus_processing';
  
  return (
    <Badge variant="secondary" className={cn('gap-1', config.className)}>
      <Icon className={cn('h-3 w-3', isAnimated && 'animate-spin')} />
      {config.label}
    </Badge>
  );
}

function SourceBadge({ source }: { source: ScanSource }) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;
  
  return (
    <div className={cn('flex items-center gap-2 px-2 py-1 rounded-md', config.bgColor)}>
      <Icon className={cn('h-4 w-4', config.color)} />
      <span className={cn('font-medium text-sm', config.color)}>{config.label}</span>
    </div>
  );
}

export function ScanHistoryTab() {
  const { data: presseLogs = [], isLoading: presseLoading } = useScanLogs();
  const { data: pappersLogs = [], isLoading: pappersLoading } = usePappersScanProgress();
  const { data: linkedinLogs = [], isLoading: linkedinLoading } = useLinkedInScanProgress();

  // Unify all scan logs into a single sorted list
  const unifiedLogs = useMemo(() => {
    const logs: UnifiedScanEntry[] = [];

    // Add Presse logs
    presseLogs.forEach(log => {
      logs.push({
        id: log.id,
        source: 'presse',
        status: log.status || 'pending',
        startedAt: log.started_at,
        completedAt: log.completed_at,
        createdAt: log.created_at || log.started_at || new Date().toISOString(),
        errorMessage: log.error_message,
        stats: [
          { label: 'Articles collectés', value: log.articles_fetched },
          { label: 'Articles analysés', value: log.articles_analyzed },
          { label: 'Signaux créés', value: log.signals_created },
        ],
      });
    });

    // Add Pappers logs
    pappersLogs.forEach(log => {
      logs.push({
        id: log.id,
        source: 'pappers',
        status: log.status || 'pending',
        startedAt: log.started_at,
        completedAt: log.completed_at,
        createdAt: log.created_at,
        errorMessage: log.error_message,
        stats: [
          { label: 'Résultats total', value: log.total_results },
          { label: 'Traités', value: log.processed_results },
          { label: 'Page', value: log.current_page },
        ],
        details: log.scan_type ? `Type: ${log.scan_type}${log.anniversary_years ? ` (${log.anniversary_years} ans)` : ''}` : undefined,
      });
    });

    // Add LinkedIn logs
    linkedinLogs?.forEach(log => {
      logs.push({
        id: log.id,
        source: 'linkedin',
        status: log.status || 'pending',
        startedAt: log.started_at,
        completedAt: log.completed_at,
        createdAt: log.created_at,
        errorMessage: log.error_message,
        stats: [
          { label: 'Sources', value: log.sources_count },
          { label: 'Posts trouvés', value: log.posts_found },
          { label: 'Engagers', value: log.engagers_found },
          { label: 'Contacts enrichis', value: log.contacts_enriched },
        ],
      });
    });

    // Sort by created_at descending
    return logs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [presseLogs, pappersLogs, linkedinLogs]);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayLogs = unifiedLogs.filter(log => new Date(log.createdAt) >= today);
    const failedLogs = unifiedLogs.filter(log => log.status === 'failed' || log.status === 'error');
    const runningLogs = unifiedLogs.filter(log => log.status === 'running' || log.status === 'pending' || log.status === 'manus_processing');
    
    return {
      total: unifiedLogs.length,
      today: todayLogs.length,
      failed: failedLogs.length,
      running: runningLogs.length,
    };
  }, [unifiedLogs]);

  const isLoading = presseLoading || pappersLoading || linkedinLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <History className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryStats.total}</p>
                <p className="text-xs text-muted-foreground">Total scans</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary/10">
                <Clock className="h-5 w-5 text-secondary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryStats.today}</p>
                <p className="text-xs text-muted-foreground">Aujourd'hui</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Loader2 className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryStats.running}</p>
                <p className="text-xs text-muted-foreground">En cours</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summaryStats.failed}</p>
                <p className="text-xs text-muted-foreground">Échecs</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scan History Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Historique des scans
          </CardTitle>
          <CardDescription>
            Tous les scans Presse, Pappers et LinkedIn avec leurs résultats
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unifiedLogs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Aucun scan enregistré</p>
            </div>
          ) : (
            <ScrollArea className="h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Source</TableHead>
                    <TableHead className="w-[100px]">Statut</TableHead>
                    <TableHead className="w-[180px]">Date</TableHead>
                    <TableHead>Statistiques</TableHead>
                    <TableHead className="w-[200px]">Erreur</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unifiedLogs.map((log) => (
                    <TableRow key={`${log.source}-${log.id}`} className={log.errorMessage ? 'bg-destructive/5' : ''}>
                      <TableCell>
                        <SourceBadge source={log.source} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={log.status} />
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            {format(new Date(log.createdAt), 'dd MMM yyyy', { locale: fr })}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(log.createdAt), 'HH:mm', { locale: fr })}
                            {log.completedAt && log.startedAt && (
                              <span className="ml-2">
                                ({Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s)
                              </span>
                            )}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {log.stats.filter(s => s.value !== null && s.value !== undefined).map((stat, idx) => (
                            <div key={idx} className="flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded">
                              <span className="text-muted-foreground">{stat.label}:</span>
                              <span className="font-semibold">{stat.value}</span>
                            </div>
                          ))}
                          {log.details && (
                            <div className="text-xs text-muted-foreground italic">
                              {log.details}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.errorMessage && (
                          <div className="flex items-start gap-2 text-destructive">
                            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                            <span className="text-xs line-clamp-2">{log.errorMessage}</span>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

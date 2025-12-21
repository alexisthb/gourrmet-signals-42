import { useState } from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  RefreshCw, 
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Rocket
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { 
  usePappersScanProgress, 
  useStartPappersScan,
  usePausePappersScan,
  useResumePappersScan,
  useDeletePappersScan,
  PappersScanProgress as ScanProgressType
} from '@/hooks/usePappersCredits';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

const ANNIVERSARY_YEARS = [5, 10, 20, 25, 30, 40, 50, 75, 100];

interface PappersScanProgressProps {
  showControls?: boolean;
}

export function PappersScanProgress({ showControls = true }: PappersScanProgressProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedYears, setSelectedYears] = useState<number[]>(ANNIVERSARY_YEARS);
  
  const { data: scans, isLoading } = usePappersScanProgress();
  const startScan = useStartPappersScan();
  const pauseScan = usePausePappersScan();
  const resumeScan = useResumePappersScan();
  const deleteScan = useDeletePappersScan();

  const activeScans = scans?.filter(s => ['pending', 'running', 'paused'].includes(s.status)) || [];
  const completedScans = scans?.filter(s => s.status === 'completed').slice(0, 5) || [];

  const handleStartScan = async (dryRun: boolean) => {
    await startScan.mutateAsync({
      years: selectedYears,
      monthsAhead: 9,
      dryRun,
    });
  };

  const toggleYear = (year: number) => {
    setSelectedYears(prev => 
      prev.includes(year) 
        ? prev.filter(y => y !== year)
        : [...prev, year].sort((a, b) => a - b)
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> En attente</Badge>;
      case 'running':
        return <Badge className="bg-blue-500"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> En cours</Badge>;
      case 'paused':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><Pause className="h-3 w-3 mr-1" /> En pause</Badge>;
      case 'completed':
        return <Badge className="bg-emerald-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Terminé</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertCircle className="h-3 w-3 mr-1" /> Erreur</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const calculateProgress = (scan: ScanProgressType) => {
    if (!scan.total_results) return 0;
    return Math.round((scan.processed_results / scan.total_results) * 100);
  };

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              Scans Progressifs
              {activeScans.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {activeScans.length} actif{activeScans.length > 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Contrôles de lancement */}
            {showControls && (
              <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Années d'anniversaire à scanner</span>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setSelectedYears(
                      selectedYears.length === ANNIVERSARY_YEARS.length ? [] : ANNIVERSARY_YEARS
                    )}
                  >
                    {selectedYears.length === ANNIVERSARY_YEARS.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </Button>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {ANNIVERSARY_YEARS.map(year => (
                    <Badge
                      key={year}
                      variant={selectedYears.includes(year) ? 'default' : 'outline'}
                      className={cn(
                        'cursor-pointer transition-colors',
                        selectedYears.includes(year) 
                          ? 'bg-primary hover:bg-primary/90' 
                          : 'hover:bg-muted'
                      )}
                      onClick={() => toggleYear(year)}
                    >
                      {year} ans
                    </Badge>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handleStartScan(true)}
                    disabled={startScan.isPending || selectedYears.length === 0}
                    variant="outline"
                    className="flex-1"
                  >
                    {startScan.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FlaskConical className="h-4 w-4 mr-2" />
                    )}
                    Simulation (sans API)
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={startScan.isPending || selectedYears.length === 0}
                        className="flex-1"
                      >
                        <Rocket className="h-4 w-4 mr-2" />
                        Lancer le scan réel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>⚠️ Confirmer le scan réel</AlertDialogTitle>
                        <AlertDialogDescription className="space-y-2">
                          <p>
                            Vous êtes sur le point de lancer un scan réel qui consommera des crédits API Pappers.
                          </p>
                          <p className="font-medium">
                            Années sélectionnées : {selectedYears.join(', ')} ans
                          </p>
                          <p className="text-orange-600">
                            Estimation : ~{(selectedYears.length * 400).toLocaleString()} crédits
                          </p>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleStartScan(false)}>
                          Confirmer et lancer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            )}

            {/* Scans actifs */}
            {activeScans.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Scans en cours</h4>
                {activeScans.map(scan => (
                  <ScanProgressCard 
                    key={scan.id} 
                    scan={scan}
                    onPause={() => pauseScan.mutate(scan.id)}
                    onResume={() => resumeScan.mutate({ scanId: scan.id, dryRun: true })}
                    onDelete={() => deleteScan.mutate(scan.id)}
                    isPausing={pauseScan.isPending}
                    isResuming={resumeScan.isPending}
                  />
                ))}
              </div>
            )}

            {/* Scans terminés récents */}
            {completedScans.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-muted-foreground">Derniers scans terminés</h4>
                {completedScans.map(scan => (
                  <div key={scan.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <div>
                        <span className="text-sm font-medium">
                          Anniversaire {scan.anniversary_years} ans
                        </span>
                        <p className="text-xs text-muted-foreground">
                          {scan.processed_results?.toLocaleString()} entreprises traitées
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {scan.completed_at && formatDistanceToNow(new Date(scan.completed_at), { 
                        addSuffix: true, 
                        locale: fr 
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* État vide */}
            {!isLoading && activeScans.length === 0 && completedScans.length === 0 && (
              <div className="text-center py-6 text-muted-foreground">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Aucun scan en cours</p>
                <p className="text-xs">Lancez une simulation pour tester sans consommer de crédits</p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

interface ScanProgressCardProps {
  scan: ScanProgressType;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  isPausing: boolean;
  isResuming: boolean;
}

function ScanProgressCard({ 
  scan, 
  onPause, 
  onResume, 
  onDelete,
  isPausing,
  isResuming
}: ScanProgressCardProps) {
  const progress = scan.total_results 
    ? Math.round((scan.processed_results / scan.total_results) * 100)
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> En attente</Badge>;
      case 'running':
        return <Badge className="bg-blue-500"><Loader2 className="h-3 w-3 mr-1 animate-spin" /> En cours</Badge>;
      case 'paused':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><Pause className="h-3 w-3 mr-1" /> En pause</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="p-4 border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <span className="font-medium">
            Anniversaire {scan.anniversary_years} ans
          </span>
          {getStatusBadge(scan.status)}
        </div>
        
        <div className="flex items-center gap-1">
          {scan.status === 'running' && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onPause}
              disabled={isPausing}
            >
              {isPausing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
            </Button>
          )}
          {scan.status === 'paused' && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onResume}
              disabled={isResuming}
            >
              {isResuming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm">
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce scan ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cette action est irréversible. La progression sera perdue.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete} className="bg-destructive">
                  Supprimer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Page {scan.current_page}{scan.total_pages ? ` / ${scan.total_pages}` : ''}
          </span>
          <span>
            {scan.processed_results?.toLocaleString()} / {scan.total_results?.toLocaleString() || '?'} entreprises
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          Période : {scan.date_creation_min} → {scan.date_creation_max}
        </span>
        {scan.started_at && (
          <span>
            Démarré {formatDistanceToNow(new Date(scan.started_at), { addSuffix: true, locale: fr })}
          </span>
        )}
      </div>
    </div>
  );
}

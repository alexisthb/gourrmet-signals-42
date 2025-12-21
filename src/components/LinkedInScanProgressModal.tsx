import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Linkedin, 
  CheckCircle, 
  Loader2, 
  User, 
  FileText, 
  ThumbsUp,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Terminal
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface ScanLogEntry {
  id: string;
  timestamp: Date;
  type: 'info' | 'success' | 'warning' | 'error';
  step: string;
  message: string;
  details?: {
    source?: string;
    postsFound?: number;
    engagersFound?: number;
    postTitle?: string;
  };
}

interface LinkedInScanProgressModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isScanning: boolean;
  result?: {
    success: boolean;
    newPosts?: number;
    engagersFound?: number;
    error?: string;
  } | null;
  sources?: Array<{
    id: string;
    name: string;
    source_type: string;
  }>;
  logs?: ScanLogEntry[];
  currentStats?: {
    sourcesProcessed: number;
    totalSources: number;
    postsFound: number;
    engagersDetected: number;
  };
}

type ScanStep = 'sources' | 'posts' | 'reactions' | 'transfer' | 'complete' | 'error';

const STEPS = [
  { id: 'sources', label: 'Récupération des sources', icon: User, duration: 2000 },
  { id: 'posts', label: 'Scraping des posts', icon: FileText, duration: 8000 },
  { id: 'reactions', label: 'Récupération des réactions', icon: ThumbsUp, duration: 12000 },
  { id: 'transfer', label: 'Transfert vers contacts', icon: User, duration: 3000 },
  { id: 'complete', label: 'Scan terminé', icon: CheckCircle, duration: 0 },
];

export function LinkedInScanProgressModal({ 
  open, 
  onOpenChange, 
  isScanning, 
  result,
  sources = [],
  logs = [],
  currentStats
}: LinkedInScanProgressModalProps) {
  const [currentStep, setCurrentStep] = useState<ScanStep>('sources');
  const [progress, setProgress] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showLogs, setShowLogs] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current && showLogs) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showLogs]);

  // Reset on new scan
  useEffect(() => {
    if (isScanning && open) {
      setCurrentStep('sources');
      setProgress(0);
      setStartTime(new Date());
      setElapsedTime(0);
    }
  }, [isScanning, open]);

  // Update step based on logs
  useEffect(() => {
    if (logs.length === 0) return;
    
    const lastLog = logs[logs.length - 1];
    if (lastLog.step && lastLog.step !== currentStep) {
      const validSteps = ['sources', 'posts', 'reactions', 'transfer', 'complete', 'error'];
      if (validSteps.includes(lastLog.step)) {
        setCurrentStep(lastLog.step as ScanStep);
      }
    }
  }, [logs, currentStep]);

  // Update progress based on stats
  useEffect(() => {
    if (!currentStats || !isScanning) return;
    
    const { sourcesProcessed, totalSources } = currentStats;
    if (totalSources > 0) {
      // Calculate progress based on current step and sources processed
      const stepWeight = {
        sources: 10,
        posts: 40,
        reactions: 40,
        transfer: 10,
      };
      
      let baseProgress = 0;
      if (currentStep === 'posts') baseProgress = 10;
      else if (currentStep === 'reactions') baseProgress = 50;
      else if (currentStep === 'transfer') baseProgress = 90;
      else if (currentStep === 'complete') baseProgress = 100;
      
      const stepProgress = currentStep !== 'complete' 
        ? (sourcesProcessed / totalSources) * (stepWeight[currentStep as keyof typeof stepWeight] || 10)
        : 0;
      
      setProgress(Math.min(baseProgress + stepProgress, 100));
    }
  }, [currentStats, currentStep, isScanning]);

  // Simulate progress if no stats
  useEffect(() => {
    if (!isScanning || !open || currentStats) return;

    const stepIndex = STEPS.findIndex(s => s.id === currentStep);
    if (stepIndex === -1 || currentStep === 'complete' || currentStep === 'error') return;

    const step = STEPS[stepIndex];
    const nextStep = STEPS[stepIndex + 1];

    const stepProgress = ((stepIndex) / (STEPS.length - 1)) * 100;
    const nextStepProgress = ((stepIndex + 1) / (STEPS.length - 1)) * 100;

    const duration = step.duration;
    const startProgress = stepProgress;
    const endProgress = nextStepProgress;
    const startT = Date.now();

    const animateProgress = () => {
      const elapsed = Date.now() - startT;
      const ratio = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - ratio, 3);
      setProgress(startProgress + (endProgress - startProgress) * eased);

      if (ratio < 1) {
        requestAnimationFrame(animateProgress);
      } else if (nextStep && nextStep.id !== 'complete') {
        setCurrentStep(nextStep.id as ScanStep);
      }
    };

    requestAnimationFrame(animateProgress);
  }, [currentStep, isScanning, open, currentStats]);

  // Update elapsed time
  useEffect(() => {
    if (!startTime || !isScanning) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime.getTime()) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, isScanning]);

  // Handle scan completion
  useEffect(() => {
    if (result && !isScanning) {
      if (result.success) {
        setCurrentStep('complete');
        setProgress(100);
      } else {
        setCurrentStep('error');
      }
    }
  }, [result, isScanning]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatLogTime = (date: Date) => {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStepStatus = (stepId: string) => {
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    const currentIndex = STEPS.findIndex(s => s.id === currentStep);

    if (currentStep === 'error') return 'error';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  const getLogIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'warning': return <AlertCircle className="h-3 w-3 text-yellow-500" />;
      case 'error': return <AlertCircle className="h-3 w-3 text-destructive" />;
      default: return <Terminal className="h-3 w-3 text-muted-foreground" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#0A66C2]/10 flex items-center justify-center">
              <Linkedin className="h-5 w-5 text-[#0A66C2]" />
            </div>
            <div className="flex-1">
              <span className="text-lg">Scan LinkedIn en cours</span>
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm font-normal text-muted-foreground">
                    {formatTime(elapsedTime)}
                  </span>
                </div>
                {currentStats && (
                  <>
                    <Badge variant="secondary" className="text-xs font-normal">
                      <FileText className="h-3 w-3 mr-1" />
                      {currentStats.postsFound} posts
                    </Badge>
                    <Badge variant="secondary" className="text-xs font-normal">
                      <User className="h-3 w-3 mr-1" />
                      {currentStats.engagersDetected} engagers
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4 flex-1 overflow-hidden flex flex-col">
          {/* Sources info */}
          {sources.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">
                Sources analysées ({currentStats?.sourcesProcessed || 0}/{sources.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {sources.map((source, idx) => (
                  <Badge 
                    key={source.id} 
                    variant={currentStats && idx < currentStats.sourcesProcessed ? 'default' : 'secondary'} 
                    className="text-xs"
                  >
                    {source.source_type === 'profile' ? '👤' : '🏢'} {source.name}
                    {currentStats && idx < currentStats.sourcesProcessed && (
                      <CheckCircle className="h-3 w-3 ml-1" />
                    )}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progression</span>
              <span className="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* Steps */}
          <div className="grid grid-cols-5 gap-2">
            {STEPS.map((step) => {
              const status = getStepStatus(step.id);
              const StepIcon = step.icon;
              
              return (
                <div 
                  key={step.id}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2 rounded-lg transition-all text-center",
                    status === 'active' && "bg-primary/5 border border-primary/20",
                    status === 'completed' && "bg-green-500/5",
                    status === 'pending' && "opacity-40",
                    status === 'error' && "bg-destructive/5 border border-destructive/20"
                  )}
                >
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center",
                    status === 'active' && "bg-primary/10",
                    status === 'completed' && "bg-green-500/10",
                    status === 'pending' && "bg-muted",
                    status === 'error' && "bg-destructive/10"
                  )}>
                    {status === 'active' ? (
                      <Loader2 className="h-4 w-4 text-primary animate-spin" />
                    ) : status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : status === 'error' ? (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <StepIcon className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] leading-tight",
                    status === 'active' && "text-primary font-medium",
                    status === 'completed' && "text-green-600",
                    status === 'pending' && "text-muted-foreground",
                    status === 'error' && "text-destructive"
                  )}>
                    {step.label.split(' ').slice(-1)[0]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Real-time Logs */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
              className="w-full justify-between text-sm font-medium mb-2"
            >
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Logs en temps réel ({logs.length})
              </div>
              {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            
            {showLogs && (
              <ScrollArea className="flex-1 rounded-lg border bg-muted/30 min-h-[120px] max-h-[200px]">
                <div className="p-2 space-y-1 font-mono text-xs">
                  {logs.length === 0 ? (
                    <div className="text-muted-foreground p-2 text-center">
                      En attente des logs...
                    </div>
                  ) : (
                    logs.map((log) => (
                      <div 
                        key={log.id} 
                        className={cn(
                          "flex items-start gap-2 p-1.5 rounded hover:bg-muted/50",
                          log.type === 'error' && "bg-destructive/10",
                          log.type === 'success' && "bg-green-500/5"
                        )}
                      >
                        <span className="text-muted-foreground shrink-0">
                          [{formatLogTime(log.timestamp)}]
                        </span>
                        {getLogIcon(log.type)}
                        <span className={cn(
                          "flex-1",
                          log.type === 'error' && "text-destructive",
                          log.type === 'success' && "text-green-600",
                          log.type === 'warning' && "text-yellow-600"
                        )}>
                          {log.message}
                          {log.details?.source && (
                            <span className="text-muted-foreground"> • {log.details.source}</span>
                          )}
                          {log.details?.postsFound !== undefined && (
                            <Badge variant="outline" className="ml-2 text-[10px] h-4">
                              {log.details.postsFound} posts
                            </Badge>
                          )}
                          {log.details?.engagersFound !== undefined && (
                            <Badge variant="outline" className="ml-1 text-[10px] h-4">
                              {log.details.engagersFound} engagers
                            </Badge>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Results */}
          {result && currentStep === 'complete' && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-green-600 font-medium">
                <CheckCircle className="h-5 w-5" />
                Scan terminé avec succès
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{result.newPosts || 0}</div>
                  <div className="text-xs text-muted-foreground">Posts analysés</div>
                </div>
                <div className="text-center p-3 bg-background rounded-lg">
                  <div className="text-2xl font-bold text-foreground">{result.engagersFound || 0}</div>
                  <div className="text-xs text-muted-foreground">Engagers trouvés</div>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {result && !result.success && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-destructive font-medium">
                <AlertCircle className="h-5 w-5" />
                Erreur lors du scan
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {result.error || 'Une erreur inattendue est survenue'}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

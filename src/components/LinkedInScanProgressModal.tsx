import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Linkedin, 
  CheckCircle, 
  Loader2, 
  User, 
  FileText, 
  ThumbsUp,
  AlertCircle,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  sources = []
}: LinkedInScanProgressModalProps) {
  const [currentStep, setCurrentStep] = useState<ScanStep>('sources');
  const [progress, setProgress] = useState(0);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Reset on new scan
  useEffect(() => {
    if (isScanning && open) {
      setCurrentStep('sources');
      setProgress(0);
      setStartTime(new Date());
      setElapsedTime(0);
    }
  }, [isScanning, open]);

  // Simulate progress through steps
  useEffect(() => {
    if (!isScanning || !open) return;

    const stepIndex = STEPS.findIndex(s => s.id === currentStep);
    if (stepIndex === -1 || currentStep === 'complete' || currentStep === 'error') return;

    const step = STEPS[stepIndex];
    const nextStep = STEPS[stepIndex + 1];

    const stepProgress = ((stepIndex) / (STEPS.length - 1)) * 100;
    const nextStepProgress = ((stepIndex + 1) / (STEPS.length - 1)) * 100;

    // Animate progress within step
    const duration = step.duration;
    const startProgress = stepProgress;
    const endProgress = nextStepProgress;
    const startT = Date.now();

    const animateProgress = () => {
      const elapsed = Date.now() - startT;
      const ratio = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - ratio, 3); // ease-out cubic
      setProgress(startProgress + (endProgress - startProgress) * eased);

      if (ratio < 1) {
        requestAnimationFrame(animateProgress);
      } else if (nextStep && nextStep.id !== 'complete') {
        setCurrentStep(nextStep.id as ScanStep);
      }
    };

    requestAnimationFrame(animateProgress);
  }, [currentStep, isScanning, open]);

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

  const getStepStatus = (stepId: string) => {
    const stepIndex = STEPS.findIndex(s => s.id === stepId);
    const currentIndex = STEPS.findIndex(s => s.id === currentStep);

    if (currentStep === 'error') return 'error';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-[#0A66C2]/10 flex items-center justify-center">
              <Linkedin className="h-5 w-5 text-[#0A66C2]" />
            </div>
            <div>
              <span className="text-lg">Scan LinkedIn en cours</span>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm font-normal text-muted-foreground">
                  {formatTime(elapsedTime)}
                </span>
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Sources info */}
          {sources.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-3">
              <div className="text-sm font-medium mb-2">Sources analysées ({sources.length})</div>
              <div className="flex flex-wrap gap-2">
                {sources.map(source => (
                  <Badge key={source.id} variant="secondary" className="text-xs">
                    {source.source_type === 'profile' ? '👤' : '🏢'} {source.name}
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
          <div className="space-y-3">
            {STEPS.map((step, index) => {
              const status = getStepStatus(step.id);
              const StepIcon = step.icon;
              
              return (
                <div 
                  key={step.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg transition-all",
                    status === 'active' && "bg-primary/5 border border-primary/20",
                    status === 'completed' && "bg-green-500/5",
                    status === 'pending' && "opacity-50",
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
                  <div className="flex-1">
                    <div className={cn(
                      "font-medium text-sm",
                      status === 'active' && "text-primary",
                      status === 'completed' && "text-green-600",
                      status === 'pending' && "text-muted-foreground",
                      status === 'error' && "text-destructive"
                    )}>
                      {step.label}
                    </div>
                    {status === 'active' && step.id === 'posts' && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Analyse des 4 derniers posts de chaque source...
                      </div>
                    )}
                    {status === 'active' && step.id === 'reactions' && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Récupération des likes et commentaires via Apify...
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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

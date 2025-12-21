import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, Activity } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export type ScanSource = 'presse' | 'pappers' | 'linkedin';

interface GenericScanProgressCardProps {
  source: ScanSource;
  isActive: boolean;
  currentStep?: number;
  totalSteps?: number;
  processedCount?: number;
  totalCount?: number;
  resultsCreated?: number;
  remainingLabel?: string;
  stepLabel?: string;
  processedLabel?: string;
  resultsLabel?: string;
}

const SOURCE_CONFIG = {
  presse: {
    bgColor: 'bg-source-presse/10',
    borderColor: 'border-source-presse/30',
    textColor: 'text-source-presse',
  },
  pappers: {
    bgColor: 'bg-source-pappers/10',
    borderColor: 'border-source-pappers/30',
    textColor: 'text-source-pappers',
  },
  linkedin: {
    bgColor: 'bg-source-linkedin/10',
    borderColor: 'border-source-linkedin/30',
    textColor: 'text-source-linkedin',
  },
};

export function GenericScanProgressCard({
  source,
  isActive,
  currentStep = 0,
  totalSteps = 1,
  processedCount = 0,
  totalCount,
  resultsCreated = 0,
  remainingLabel = 'éléments restants',
  stepLabel = 'Batch actuel',
  processedLabel = 'Traités',
  resultsLabel = 'Signaux créés',
}: GenericScanProgressCardProps) {
  const config = SOURCE_CONFIG[source];
  
  // Calculate progress
  const progressPercent = totalCount && totalCount > 0
    ? Math.round((processedCount / totalCount) * 100)
    : 0;

  const remaining = totalCount ? totalCount - processedCount : 0;

  if (!isActive) {
    return null;
  }

  return (
    <div className={cn(
      'rounded-xl border p-5 animate-pulse-slow',
      config.bgColor,
      config.borderColor
    )}>
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className={cn('h-5 w-5 animate-spin', config.textColor)} />
        <h3 className="font-semibold text-foreground">Scan en cours</h3>
      </div>

      <div className="space-y-4">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Progression</span>
            <span className={cn('font-medium', config.textColor)}>{progressPercent}%</span>
          </div>
          <Progress value={progressPercent} className="h-2" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-background/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <Activity className="h-3 w-3" />
              {stepLabel}
            </div>
            <p className="text-lg font-bold text-foreground">
              {currentStep} / {totalSteps}
            </p>
          </div>
          
          <div className="bg-background/50 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
              <CheckCircle className="h-3 w-3" />
              {processedLabel}
            </div>
            <p className="text-lg font-bold text-foreground">{processedCount}</p>
          </div>
        </div>

        {/* Results created */}
        {resultsCreated > 0 && (
          <div className="flex items-center justify-between bg-success/10 rounded-lg p-3">
            <span className="text-sm text-muted-foreground">{resultsLabel}</span>
            <span className="text-lg font-bold text-success">{resultsCreated}</span>
          </div>
        )}

        {/* Remaining info */}
        <p className="text-xs text-muted-foreground text-center">
          {remaining} {remainingLabel} • Rafraîchissement auto toutes les 3s
        </p>
      </div>
    </div>
  );
}

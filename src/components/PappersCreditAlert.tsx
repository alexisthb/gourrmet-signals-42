import { AlertTriangle, TrendingUp, Gauge, Ban } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePappersCreditsSummary, usePappersPlanSettings } from '@/hooks/usePappersCredits';
import { cn } from '@/lib/utils';

interface PappersCreditAlertProps {
  compact?: boolean;
  showDetails?: boolean;
}

export function PappersCreditAlert({ compact = false, showDetails = true }: PappersCreditAlertProps) {
  const credits = usePappersCreditsSummary();
  const { data: planSettings } = usePappersPlanSettings();

  const getStatusColor = () => {
    if (credits.isBlocked) return 'text-destructive';
    if (credits.isCritical) return 'text-orange-500';
    if (credits.isWarning) return 'text-yellow-500';
    return 'text-emerald-500';
  };

  const getProgressColor = () => {
    if (credits.isBlocked) return 'bg-destructive';
    if (credits.isCritical) return 'bg-orange-500';
    if (credits.isWarning) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getStatusIcon = () => {
    if (credits.isBlocked) return Ban;
    if (credits.isCritical) return AlertTriangle;
    if (credits.isWarning) return Gauge;
    return TrendingUp;
  };

  const StatusIcon = getStatusIcon();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <StatusIcon className={cn('h-4 w-4', getStatusColor())} />
        <span className={cn('text-sm font-medium', getStatusColor())}>
          {credits.percent}%
        </span>
        <Progress 
          value={credits.percent} 
          className="w-16 h-2"
        />
      </div>
    );
  }

  return (
    <Card className={cn(
      'border-l-4',
      credits.isBlocked ? 'border-l-destructive bg-destructive/5' :
      credits.isCritical ? 'border-l-orange-500 bg-orange-500/5' :
      credits.isWarning ? 'border-l-yellow-500 bg-yellow-500/5' :
      'border-l-emerald-500 bg-emerald-500/5'
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-full',
              credits.isBlocked ? 'bg-destructive/10' :
              credits.isCritical ? 'bg-orange-500/10' :
              credits.isWarning ? 'bg-yellow-500/10' :
              'bg-emerald-500/10'
            )}>
              <StatusIcon className={cn('h-5 w-5', getStatusColor())} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">
                  Crédits API Pappers
                </span>
                <Badge variant="outline" className="text-xs">
                  {planSettings?.plan_name || 'Standard'}
                </Badge>
              </div>
              {showDetails && (
                <p className="text-sm text-muted-foreground">
                  {credits.used.toLocaleString()} / {credits.limit.toLocaleString()} crédits utilisés ce mois
                </p>
              )}
            </div>
          </div>

          <div className="text-right">
            <div className={cn('text-2xl font-bold', getStatusColor())}>
              {credits.percent}%
            </div>
            <div className="text-xs text-muted-foreground">
              {credits.remaining.toLocaleString()} restants
            </div>
          </div>
        </div>

        <div className="mt-3">
          <Progress 
            value={credits.percent} 
            className="h-2"
          />
        </div>

        {/* Alertes */}
        {credits.isBlocked && (
          <div className="mt-3 p-2 rounded bg-destructive/10 text-destructive text-sm flex items-center gap-2">
            <Ban className="h-4 w-4" />
            Limite atteinte ! Les scans sont bloqués jusqu'au prochain mois.
          </div>
        )}
        {credits.isCritical && !credits.isBlocked && (
          <div className="mt-3 p-2 rounded bg-orange-500/10 text-orange-700 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Attention : {100 - credits.percent}% des crédits restants. Planifiez vos scans.
          </div>
        )}
        {credits.isWarning && !credits.isCritical && (
          <div className="mt-3 p-2 rounded bg-yellow-500/10 text-yellow-700 text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4" />
            Consommation élevée. Surveillez votre utilisation.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

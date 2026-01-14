import { cn } from '@/lib/utils';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

interface SignalTypeBadgeProps {
  type: SignalType;
  showEmoji?: boolean;
  className?: string;
}

export function SignalTypeBadge({ type, showEmoji = true, className }: SignalTypeBadgeProps) {
  const config = SIGNAL_TYPE_CONFIG[type];
  
  // Fallback pour les types inconnus
  if (!config) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold',
          'bg-muted text-muted-foreground',
          className
        )}
      >
        {showEmoji && <span>📋</span>}
        <span>{type || 'Inconnu'}</span>
      </span>
    );
  }

  const colorClasses: Record<SignalType, string> = {
    // Presse - Coral tones
    anniversaire: 'bg-primary/10 text-primary',
    levee: 'bg-secondary/10 text-secondary',
    ma: 'bg-primary/10 text-primary',
    distinction: 'bg-accent/20 text-accent-foreground',
    expansion: 'bg-secondary/10 text-secondary',
    nomination: 'bg-muted text-muted-foreground',
    // LinkedIn - Yellow tones
    linkedin_engagement: 'bg-accent/20 text-accent-foreground',
    // Pappers - Turquoise tones
    anniversary: 'bg-primary/10 text-primary',
    capital_increase: 'bg-secondary/10 text-secondary',
    transfer: 'bg-secondary/10 text-secondary',
    creation: 'bg-secondary/10 text-secondary',
    radiation: 'bg-destructive/10 text-destructive',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold',
        colorClasses[type],
        className
      )}
    >
      {showEmoji && <span>{config.emoji}</span>}
      <span>{config.label}</span>
    </span>
  );
}

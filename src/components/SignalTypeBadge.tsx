import { cn } from '@/lib/utils';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';

interface SignalTypeBadgeProps {
  type: SignalType;
  showEmoji?: boolean;
  className?: string;
}

export function SignalTypeBadge({ type, showEmoji = true, className }: SignalTypeBadgeProps) {
  const config = SIGNAL_TYPE_CONFIG[type];

  const colorClasses: Record<SignalType, string> = {
    anniversaire: 'bg-primary/10 text-primary border-primary/20',
    levee: 'bg-success/10 text-success border-success/20',
    ma: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    distinction: 'bg-warning/10 text-warning border-warning/20',
    expansion: 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    nomination: 'bg-muted text-muted-foreground border-border',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border',
        colorClasses[type],
        className
      )}
    >
      {showEmoji && <span>{config.emoji}</span>}
      <span>{config.label}</span>
    </span>
  );
}

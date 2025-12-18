import { cn } from '@/lib/utils';
import { STATUS_CONFIG, type SignalStatus } from '@/types/database';

interface StatusBadgeProps {
  status: SignalStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border',
        config.color,
        className
      )}
    >
      {config.label}
    </span>
  );
}

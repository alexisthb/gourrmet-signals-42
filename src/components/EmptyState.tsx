import { LucideIcon, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EmptyState - design Gourrmet (cf. handoff/CHECKLIST.md sec. 4).
 *
 * Centre, padding 48x24, icone optionnelle 32px en sable-100,
 * titre 15px navy-800, description fg-3.
 */
interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-6 text-center', className)}>
      <div className="p-3 rounded-full bg-sable-100 mb-3">
        <Icon className="h-7 w-7 text-fg-3" strokeWidth={1.6} />
      </div>
      <h3 className="text-[15px] font-semibold text-navy-800">{title}</h3>
      {description && (
        <p className="text-[13px] text-fg-3 mt-1 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

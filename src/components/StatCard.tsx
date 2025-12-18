import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

export function StatCard({ label, value, icon: Icon, iconColor = 'text-primary', trend, className }: StatCardProps) {
  return (
    <div className={cn('stat-card', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
          {trend && (
            <p className={cn(
              'text-xs mt-2 font-medium',
              trend.isPositive ? 'text-success' : 'text-destructive'
            )}>
              {trend.isPositive ? '+' : ''}{trend.value}% vs semaine dernière
            </p>
          )}
        </div>
        <div className={cn('p-3 rounded-xl bg-primary/10', iconColor.includes('success') && 'bg-success/10', iconColor.includes('warning') && 'bg-warning/10')}>
          <Icon className={cn('h-6 w-6', iconColor)} />
        </div>
      </div>
    </div>
  );
}

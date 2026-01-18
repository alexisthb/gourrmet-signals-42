import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  variant?: 'coral' | 'turquoise' | 'yellow' | 'default';
  /** @deprecated Use variant instead */
  iconColor?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
}

const variantStyles = {
  coral: {
    bg: 'bg-gradient-to-br from-primary/15 to-primary/5',
    icon: 'bg-primary text-white',
    border: 'border-primary/20',
  },
  turquoise: {
    bg: 'bg-gradient-to-br from-secondary/15 to-secondary/5',
    icon: 'bg-secondary text-white',
    border: 'border-secondary/20',
  },
  yellow: {
    bg: 'bg-gradient-to-br from-accent/20 to-accent/5',
    icon: 'bg-accent text-accent-foreground',
    border: 'border-accent/30',
  },
  default: {
    bg: 'bg-card',
    icon: 'bg-muted text-muted-foreground',
    border: 'border-border',
  },
};

// Map old iconColor to new variant
function getVariantFromIconColor(iconColor?: string): 'coral' | 'turquoise' | 'yellow' | 'default' {
  if (!iconColor) return 'default';
  if (iconColor.includes('primary') || iconColor.includes('coral') || iconColor.includes('amber') || iconColor.includes('orange')) return 'coral';
  if (iconColor.includes('success') || iconColor.includes('emerald') || iconColor.includes('green') || iconColor.includes('teal') || iconColor.includes('cyan')) return 'turquoise';
  if (iconColor.includes('warning') || iconColor.includes('yellow') || iconColor.includes('blue') || iconColor.includes('violet') || iconColor.includes('purple')) return 'yellow';
  return 'default';
}

export function StatCard({ label, value, icon: Icon, variant, iconColor, trend, className }: StatCardProps) {
  const resolvedVariant = variant ?? getVariantFromIconColor(iconColor);
  const styles = variantStyles[resolvedVariant];
  
  return (
    <div className={cn(
      'rounded-3xl border p-6 transition-all duration-300 hover:shadow-xl hover:-translate-y-1',
      styles.bg,
      styles.border,
      className
    )}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-medium">{label}</p>
          <p className="text-4xl font-display font-bold text-foreground mt-2">{value}</p>
          {trend && (
            <p className={cn(
              'text-xs mt-3 font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-full',
              trend.isPositive 
                ? 'text-secondary bg-secondary/10' 
                : 'text-destructive bg-destructive/10'
            )}>
              {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs semaine dernière
            </p>
          )}
        </div>
        <div className={cn('p-2 rounded-xl shadow-md', styles.icon)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

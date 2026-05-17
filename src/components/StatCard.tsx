import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

/**
 * StatCard - design Gourrmet KPI (cf. handoff/CHECKLIST.md sec. 4).
 *
 * Padding 22px, hover border-indigo-200, eyebrow mono caps en haut,
 * nombre 38px/700/navy-800/tracking-tight, trend chip mono 11px.
 *
 * L'API publique est conservee pour compat (variant + iconColor) mais
 * toutes les variantes resolvent maintenant sur la meme palette indigo
 * dominante - la differenciation reelle se fait par icone Lucide.
 */
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

// Variantes preservees pour compat - desormais alignees sur la nouvelle palette.
// L'icone garde une teinte semantique discrete mais le fond reste neutre.
const variantStyles = {
  coral: {
    iconBg: 'bg-source-presse-bg',
    iconColor: 'text-source-presse-foreground',
  },
  turquoise: {
    iconBg: 'bg-source-linkedin-bg',
    iconColor: 'text-source-linkedin-foreground',
  },
  yellow: {
    iconBg: 'bg-indigo-50',
    iconColor: 'text-indigo-700',
  },
  default: {
    iconBg: 'bg-sable-100',
    iconColor: 'text-fg-3',
  },
};

function getVariantFromIconColor(iconColor?: string): 'coral' | 'turquoise' | 'yellow' | 'default' {
  if (!iconColor) return 'default';
  if (iconColor.includes('primary') || iconColor.includes('coral') || iconColor.includes('amber') || iconColor.includes('orange') || iconColor.includes('presse')) return 'coral';
  if (iconColor.includes('success') || iconColor.includes('emerald') || iconColor.includes('green') || iconColor.includes('teal') || iconColor.includes('cyan') || iconColor.includes('linkedin')) return 'turquoise';
  if (iconColor.includes('warning') || iconColor.includes('yellow') || iconColor.includes('blue') || iconColor.includes('violet') || iconColor.includes('purple') || iconColor.includes('indigo')) return 'yellow';
  return 'default';
}

export function StatCard({ label, value, icon: Icon, variant, iconColor, trend, className }: StatCardProps) {
  const resolvedVariant = variant ?? getVariantFromIconColor(iconColor);
  const styles = variantStyles[resolvedVariant];

  return (
    <div className={cn(
      'rounded-card border border-border bg-surface p-[22px] transition-colors duration-150 hover:border-indigo-200',
      className,
    )}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-fg-3 font-semibold leading-tight">
          {label}
        </p>
        <div className={cn('p-1.5 rounded-lg flex-shrink-0', styles.iconBg)}>
          <Icon className={cn('h-4 w-4', styles.iconColor)} strokeWidth={1.8} />
        </div>
      </div>
      <p className="text-[38px] font-bold text-navy-800 tracking-[-0.025em] leading-[1.05] mt-2">
        {value}
      </p>
      {trend && (
        <p
          className={cn(
            'mt-2 inline-flex items-center gap-1 font-mono font-semibold text-[11px] px-2 py-0.5 rounded-full',
            trend.isPositive
              ? 'text-success bg-success-bg'
              : 'text-danger bg-danger-bg'
          )}
        >
          {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs semaine dernière
        </p>
      )}
    </div>
  );
}

import { cn } from '@/lib/utils';
import { Newspaper, Building2, Linkedin } from 'lucide-react';

export type SignalSource = 'presse' | 'pappers' | 'linkedin';

interface SourceBadgeProps {
  source: SignalSource;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * SourceBadge — design Gourrmet.
 * Couleurs alignees sur les sources : terracotta / indigo / teal.
 */
const SOURCE_CONFIG: Record<SignalSource, {
  label: string;
  icon: typeof Newspaper;
  badgeClass: string;
  dotClass: string;
}> = {
  presse: {
    label: 'Presse',
    icon: Newspaper,
    badgeClass: 'bg-source-presse-bg text-source-presse-foreground',
    dotClass: 'bg-source-presse',
  },
  pappers: {
    label: 'Pappers',
    icon: Building2,
    badgeClass: 'bg-source-pappers-bg text-source-pappers-foreground',
    dotClass: 'bg-source-pappers',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    badgeClass: 'bg-source-linkedin-bg text-source-linkedin-foreground',
    dotClass: 'bg-source-linkedin',
  },
};

export function SourceBadge({ source, showLabel = true, size = 'sm', className }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;

  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-1 text-[11.5px] gap-1.5'
      : 'px-3 py-1.5 text-[13px] gap-2';

  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-badge font-semibold',
        config.badgeClass,
        sizeClasses,
        className
      )}
    >
      <Icon className={iconSize} strokeWidth={1.8} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

/**
 * Determine la source d'un signal basee sur source_name ET signal_type.
 * Priorite: source_name > signal_type.
 */
export function getSourceFromSignalType(signalType?: string, sourceName?: string): SignalSource | null {
  if (!signalType && !sourceName) return null;

  if (sourceName) {
    const sourceNameLower = sourceName.toLowerCase();
    if (sourceNameLower === 'pappers') return 'pappers';
    if (sourceNameLower === 'linkedin' || sourceNameLower.includes('linkedin')) return 'linkedin';
    return 'presse';
  }

  if (signalType) {
    if (signalType === 'linkedin_engagement' || signalType.startsWith('linkedin_')) {
      return 'linkedin';
    }
    if (['anniversary', 'capital_increase', 'transfer', 'creation', 'radiation'].includes(signalType)) {
      return 'pappers';
    }
    if (['anniversaire', 'levee', 'ma', 'expansion', 'distinction', 'nomination'].includes(signalType)) {
      return 'presse';
    }
  }

  return 'presse';
}

export function SourceIndicatorDot({ source, className }: { source: SignalSource; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full',
        SOURCE_CONFIG[source].dotClass,
        className
      )}
      title={SOURCE_CONFIG[source].label}
    />
  );
}

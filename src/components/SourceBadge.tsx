import { cn } from '@/lib/utils';
import { Newspaper, Building2, Linkedin } from 'lucide-react';

export type SignalSource = 'presse' | 'pappers' | 'linkedin';

interface SourceBadgeProps {
  source: SignalSource;
  showLabel?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

const SOURCE_CONFIG: Record<SignalSource, { 
  label: string; 
  icon: typeof Newspaper;
  colorClass: string;
  bgClass: string;
  borderClass: string;
}> = {
  presse: {
    label: 'Presse',
    icon: Newspaper,
    colorClass: 'text-source-presse',
    bgClass: 'bg-source-presse/10',
    borderClass: 'border-source-presse/30',
  },
  pappers: {
    label: 'Pappers',
    icon: Building2,
    colorClass: 'text-source-pappers',
    bgClass: 'bg-source-pappers/10',
    borderClass: 'border-source-pappers/30',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    colorClass: 'text-source-linkedin',
    bgClass: 'bg-source-linkedin/10',
    borderClass: 'border-source-linkedin/30',
  },
};

export function SourceBadge({ source, showLabel = true, size = 'sm', className }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;
  
  const sizeClasses = size === 'sm' 
    ? 'px-2 py-0.5 text-xs gap-1'
    : 'px-2.5 py-1 text-sm gap-1.5';
  
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md font-medium border',
        config.bgClass,
        config.borderClass,
        config.colorClass,
        sizeClasses,
        className
      )}
    >
      <Icon className={iconSize} />
      {showLabel && <span>{config.label}</span>}
    </span>
  );
}

export function getSourceFromSignalType(signalType?: string): SignalSource | null {
  if (!signalType) return null;

  // LinkedIn
  if (signalType === 'linkedin_engagement' || signalType.startsWith('linkedin_')) {
    return 'linkedin';
  }

  // Signaux Pappers: anniversaire, levee, ma, expansion
  if (['anniversaire', 'levee', 'ma', 'expansion'].includes(signalType)) {
    return 'pappers';
  }

  // Signaux Presse: distinction, nomination, etc (from news analysis)
  if (['distinction', 'nomination'].includes(signalType)) {
    return 'presse';
  }

  return 'presse'; // Default to presse for news-based signals
}

export function SourceIndicatorDot({ source, className }: { source: SignalSource; className?: string }) {
  const config = SOURCE_CONFIG[source];
  
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full',
        source === 'presse' && 'bg-source-presse',
        source === 'pappers' && 'bg-source-pappers',
        source === 'linkedin' && 'bg-source-linkedin',
        className
      )}
      title={config.label}
    />
  );
}

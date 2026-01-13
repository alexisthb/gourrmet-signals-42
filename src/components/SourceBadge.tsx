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

/**
 * Détermine la source d'un signal basée sur source_name ET signal_type
 * Priorité: source_name > signal_type
 */
export function getSourceFromSignalType(signalType?: string, sourceName?: string): SignalSource | null {
  if (!signalType && !sourceName) return null;

  // 1. Vérifier d'abord source_name (plus fiable)
  if (sourceName) {
    const sourceNameLower = sourceName.toLowerCase();
    if (sourceNameLower === 'pappers') return 'pappers';
    if (sourceNameLower === 'linkedin' || sourceNameLower.includes('linkedin')) return 'linkedin';
    // Tout autre source_name est considéré comme presse (NewsAPI, etc.)
    return 'presse';
  }

  // 2. Fallback sur signal_type si pas de source_name
  if (signalType) {
    // LinkedIn
    if (signalType === 'linkedin_engagement' || signalType.startsWith('linkedin_')) {
      return 'linkedin';
    }

    // Signaux Pappers (types internes API Pappers)
    if (['anniversary', 'capital_increase', 'transfer', 'creation', 'radiation'].includes(signalType)) {
      return 'pappers';
    }

    // Signaux qui peuvent venir de Presse OU Pappers selon le contexte
    // - anniversaire peut venir de Presse (article news) ou Pappers (API)
    // - nomination peut venir de Presse (article news) ou Pappers (API)
    // Sans source_name, on suppose presse par défaut
    if (['anniversaire', 'levee', 'ma', 'expansion', 'distinction', 'nomination'].includes(signalType)) {
      return 'presse';
    }
  }

  return 'presse'; // Default to presse for unknown signals
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

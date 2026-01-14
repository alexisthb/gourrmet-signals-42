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
}> = {
  presse: {
    label: 'Presse',
    icon: Newspaper,
    colorClass: 'text-primary',
    bgClass: 'bg-primary/10',
  },
  pappers: {
    label: 'Pappers',
    icon: Building2,
    colorClass: 'text-secondary',
    bgClass: 'bg-secondary/10',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    colorClass: 'text-accent-foreground',
    bgClass: 'bg-accent/20',
  },
};

export function SourceBadge({ source, showLabel = true, size = 'sm', className }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[source];
  const Icon = config.icon;
  
  const sizeClasses = size === 'sm' 
    ? 'px-3 py-1 text-xs gap-1.5'
    : 'px-4 py-1.5 text-sm gap-2';
  
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold',
        config.bgClass,
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
    if (['anniversaire', 'levee', 'ma', 'expansion', 'distinction', 'nomination'].includes(signalType)) {
      return 'presse';
    }
  }

  return 'presse'; // Default to presse for unknown signals
}

export function SourceIndicatorDot({ source, className }: { source: SignalSource; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-full shadow-lg',
        source === 'presse' && 'bg-primary shadow-primary/30',
        source === 'pappers' && 'bg-secondary shadow-secondary/30',
        source === 'linkedin' && 'bg-accent shadow-accent/30',
        className
      )}
      title={SOURCE_CONFIG[source].label}
    />
  );
}

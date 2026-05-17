import { cn } from '@/lib/utils';
import { SIGNAL_TYPE_CONFIG, type SignalType } from '@/types/database';
import { SignalTypeIcon } from './SignalTypeIcon';
import { HelpCircle } from 'lucide-react';

interface SignalTypeBadgeProps {
  type: SignalType;
  /** Affiche l'icone Lucide (par defaut: true). Remplace l'ancien `showEmoji`. */
  showEmoji?: boolean;
  className?: string;
}

/**
 * Badge type de signal en monochrome indigo (design Gourrmet).
 * La differenciation visuelle se fait par icone Lucide, pas par couleur.
 * Reference: handoff/PROMPT.md - section "Types signaux maintenant monochromes".
 */
export function SignalTypeBadge({ type, showEmoji = true, className }: SignalTypeBadgeProps) {
  const config = SIGNAL_TYPE_CONFIG[type];

  if (!config) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold',
          'bg-muted text-muted-foreground',
          className
        )}
      >
        {showEmoji && <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.8} />}
        <span>{type || 'Inconnu'}</span>
      </span>
    );
  }

  // Couleur du badge selon la source du type (presse/pappers/linkedin).
  const sourceColorClass: Record<string, string> = {
    presse:   'bg-source-presse-bg text-source-presse-foreground',
    pappers:  'bg-source-pappers-bg text-source-pappers-foreground',
    linkedin: 'bg-source-linkedin-bg text-source-linkedin-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11.5px] font-semibold',
        sourceColorClass[config.source] || 'bg-indigo-50 text-indigo-700',
        className
      )}
    >
      {showEmoji && <SignalTypeIcon type={type} className="h-3.5 w-3.5" />}
      <span>{config.label}</span>
    </span>
  );
}

import { LucideIcon, Cake, Coins, Handshake, Award, Building2, Briefcase, Linkedin, MapPin, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SignalType } from '@/types/database';

/**
 * Mapping type de signal -> icone Lucide.
 * Remplace les emojis (🎂 💰 🤝 🏆 🏢 👔) dans l'UI Gourrmet (cf. handoff/PROMPT.md).
 * Les emojis restent dans `SIGNAL_TYPE_CONFIG.emoji` pour compat eventuelle
 * mais ne devraient plus etre rendus dans l'UI de production.
 */
export const SIGNAL_TYPE_ICONS: Record<SignalType, LucideIcon> = {
  // Presse
  anniversaire: Cake,
  levee: Coins,
  ma: Handshake,
  distinction: Award,
  expansion: Building2,
  nomination: Briefcase,
  // LinkedIn
  linkedin_engagement: Linkedin,
  // Pappers
  anniversary: Cake,
  capital_increase: Coins,
  transfer: MapPin,
  creation: Sparkles,
  radiation: X,
};

interface SignalTypeIconProps {
  type: SignalType;
  className?: string;
}

/**
 * Rendu de l'icone Lucide correspondant au type de signal.
 * Usage : `<SignalTypeIcon type={signal.signal_type} className="h-4 w-4 text-indigo-600" />`
 */
export function SignalTypeIcon({ type, className }: SignalTypeIconProps) {
  const Icon = SIGNAL_TYPE_ICONS[type];
  if (!Icon) return null;
  return <Icon className={cn('h-4 w-4', className)} strokeWidth={1.8} />;
}

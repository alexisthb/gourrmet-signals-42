// Types de signaux unifiés (Presse + Pappers + LinkedIn)
export type SignalType = 
  // Presse
  | 'anniversaire' 
  | 'levee' 
  | 'ma' 
  | 'distinction' 
  | 'expansion' 
  | 'nomination' 
  // LinkedIn
  | 'linkedin_engagement'
  // Pappers (types internes utilisés par l'API)
  | 'anniversary'
  | 'capital_increase'
  | 'transfer'
  | 'creation'
  | 'radiation';

export type SignalStatus = 'new' | 'contacted' | 'meeting' | 'proposal' | 'won' | 'lost' | 'ignored';
export type EstimatedSize = 'PME' | 'ETI' | 'Grand Compte' | 'Inconnu';
export type ScanStatus = 'running' | 'completed' | 'failed';

export interface SearchQuery {
  id: string;
  name: string;
  query: string;
  category: SignalType;
  is_active: boolean;
  last_fetched_at: string | null;
  created_at: string;
  description?: string | null;
}

export interface RawArticle {
  id: string;
  query_id: string | null;
  title: string;
  description: string | null;
  content: string | null;
  url: string;
  source_name: string | null;
  author: string | null;
  image_url: string | null;
  published_at: string | null;
  fetched_at: string;
  processed: boolean;
  created_at: string;
}

export type EnrichmentStatus = 'none' | 'pending' | 'processing' | 'manus_processing' | 'completed' | 'failed';

export interface Signal {
  id: string;
  article_id: string | null;
  company_name: string;
  signal_type: SignalType;
  event_detail: string | null;
  sector: string | null;
  estimated_size: EstimatedSize;
  score: number;
  hook_suggestion: string | null;
  source_url: string | null;
  source_name: string | null;
  status: SignalStatus;
  notes: string | null;
  contacted_at: string | null;
  detected_at: string;
  created_at: string;
  enrichment_status?: EnrichmentStatus;
  revenue?: number | null;
  revenue_source?: string | null;
}

export interface Setting {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface ScanLog {
  id: string;
  started_at: string;
  completed_at: string | null;
  articles_fetched: number;
  articles_analyzed: number;
  signals_created: number;
  status: ScanStatus;
  error_message: string | null;
  created_at: string;
}

export type SignalSource = 'presse' | 'pappers' | 'linkedin';

// Configuration unifiée de tous les types de signaux.
// `source` permet de filtrer l'affichage par origine et éviter les doublons
// (ex: "Anniversaire" est à la fois `anniversaire` côté Presse et `anniversary` côté Pappers).
export const SIGNAL_TYPE_CONFIG: Record<SignalType, { label: string; emoji: string; color: string; source: SignalSource }> = {
  // Presse
  anniversaire: { label: 'Anniversaire', emoji: '🎂', color: 'bg-signal-anniversaire', source: 'presse' },
  levee: { label: 'Levée de fonds', emoji: '💰', color: 'bg-signal-levee', source: 'presse' },
  ma: { label: 'Fusion & Acquisition', emoji: '🤝', color: 'bg-signal-ma', source: 'presse' },
  distinction: { label: 'Distinction', emoji: '🏆', color: 'bg-signal-distinction', source: 'presse' },
  expansion: { label: 'Expansion', emoji: '🏢', color: 'bg-signal-expansion', source: 'presse' },
  nomination: { label: 'Nomination', emoji: '👔', color: 'bg-signal-nomination', source: 'presse' },
  // LinkedIn
  linkedin_engagement: { label: 'LinkedIn', emoji: '💼', color: 'bg-signal-linkedin', source: 'linkedin' },
  // Pappers
  anniversary: { label: 'Anniversaire', emoji: '🎂', color: 'bg-signal-anniversaire', source: 'pappers' },
  capital_increase: { label: 'Levée de fonds', emoji: '💰', color: 'bg-signal-levee', source: 'pappers' },
  transfer: { label: 'Déménagement', emoji: '📍', color: 'bg-signal-expansion', source: 'pappers' },
  creation: { label: 'Création', emoji: '🚀', color: 'bg-success', source: 'pappers' },
  radiation: { label: 'Radiation', emoji: '❌', color: 'bg-destructive', source: 'pappers' },
};

export const PRESSE_SIGNAL_TYPES = Object.entries(SIGNAL_TYPE_CONFIG)
  .filter(([, cfg]) => cfg.source === 'presse')
  .map(([key]) => key as SignalType);

export const PAPPERS_SIGNAL_TYPES = Object.entries(SIGNAL_TYPE_CONFIG)
  .filter(([, cfg]) => cfg.source === 'pappers')
  .map(([key]) => key as SignalType);

export const LINKEDIN_SIGNAL_TYPES = Object.entries(SIGNAL_TYPE_CONFIG)
  .filter(([, cfg]) => cfg.source === 'linkedin')
  .map(([key]) => key as SignalType);

export const STATUS_CONFIG: Record<SignalStatus, { label: string; color: string }> = {
  new: { label: 'Nouveau', color: 'bg-success/10 text-success border-success/30' },
  contacted: { label: 'Contacté', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  meeting: { label: 'RDV', color: 'bg-primary/10 text-primary border-primary/30' },
  proposal: { label: 'Proposition', color: 'bg-warning/10 text-warning border-warning/30' },
  won: { label: 'Gagné', color: 'bg-success text-success-foreground border-success' },
  lost: { label: 'Perdu', color: 'bg-destructive/10 text-destructive border-destructive/30' },
  ignored: { label: 'Ignoré', color: 'bg-muted text-muted-foreground border-border' },
};

export type SignalType = 'anniversaire' | 'levee' | 'ma' | 'distinction' | 'expansion' | 'nomination';
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

export type EnrichmentStatus = 'none' | 'pending' | 'processing' | 'completed' | 'failed';

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

export const SIGNAL_TYPE_CONFIG: Record<SignalType, { label: string; emoji: string; color: string }> = {
  anniversaire: { label: 'Anniversaire', emoji: '🎂', color: 'bg-signal-anniversaire' },
  levee: { label: 'Levée de fonds', emoji: '💰', color: 'bg-signal-levee' },
  ma: { label: 'Fusion & Acquisition', emoji: '🤝', color: 'bg-signal-ma' },
  distinction: { label: 'Distinction', emoji: '🏆', color: 'bg-signal-distinction' },
  expansion: { label: 'Expansion', emoji: '🏢', color: 'bg-signal-expansion' },
  nomination: { label: 'Nomination', emoji: '👔', color: 'bg-signal-nomination' },
};

export const STATUS_CONFIG: Record<SignalStatus, { label: string; color: string }> = {
  new: { label: 'Nouveau', color: 'bg-success/10 text-success border-success/30' },
  contacted: { label: 'Contacté', color: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  meeting: { label: 'RDV', color: 'bg-primary/10 text-primary border-primary/30' },
  proposal: { label: 'Proposition', color: 'bg-warning/10 text-warning border-warning/30' },
  won: { label: 'Gagné', color: 'bg-success text-success-foreground border-success' },
  lost: { label: 'Perdu', color: 'bg-destructive/10 text-destructive border-destructive/30' },
  ignored: { label: 'Ignoré', color: 'bg-muted text-muted-foreground border-border' },
};

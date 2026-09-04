// GR-003 — Groupage des signaux par entreprise (approche douce).
// Travaille sur les signaux deja fetches via useSignals — pas de query DB supplementaire.

import { useMemo } from 'react';
import type { Signal } from '@/types/database';

export interface GroupedSignal {
  /** Cle de groupe : nom normalise lowercase + sans accents */
  companyKey: string;
  /** Nom affichage : celui du signal le plus recent du groupe */
  companyName: string;
  /** Signal le plus recent du groupe — utilise pour le rendu de la card principale */
  latestSignal: Signal;
  /** Tous les signaux du groupe, du plus recent au plus ancien */
  signals: Signal[];
  /** Nombre total de signaux pour ce groupe */
  count: number;
  /** True si au moins un signal a deja ete envoye (pipeline_status='sent' ou 'replied') */
  alreadyContacted: boolean;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function useGroupedSignals(signals: Signal[] | undefined): GroupedSignal[] {
  return useMemo(() => {
    if (!signals || signals.length === 0) return [];

    const groups = new Map<string, Signal[]>();
    for (const signal of signals) {
      const key = normalize(signal.company_name);
      if (!key) continue;
      const existing = groups.get(key);
      if (existing) {
        existing.push(signal);
      } else {
        groups.set(key, [signal]);
      }
    }

    const result: GroupedSignal[] = [];
    for (const [companyKey, groupSignals] of groups) {
      const sorted = [...groupSignals].sort(
        (a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime()
      );
      const latest = sorted[0];
      result.push({
        companyKey,
        companyName: latest.company_name,
        latestSignal: latest,
        signals: sorted,
        count: sorted.length,
        alreadyContacted: sorted.some(
          (s) => s.pipeline_status === 'sent' || s.pipeline_status === 'replied' || s.status === 'contacted'
        ),
      });
    }

    // Tri du resultat : signal le plus recent en premier (comme la liste flat)
    return result.sort(
      (a, b) =>
        new Date(b.latestSignal.detected_at).getTime() - new Date(a.latestSignal.detected_at).getTime()
    );
  }, [signals]);
}

// ─────────────────────────────────────────────────────────────────────────────
// GR-003 étendu aux listes NON-presse (demande Clotilde 04/09) : les cartes
// Pappers doivent savoir si l'entreprise a déjà été contactée via un AUTRE
// signal, toutes sources confondues. On charge une fois les entreprises
// contactées et on compare avec la MÊME normalisation que l'écran presse —
// deux écrans qui normalisent différemment finiraient par se contredire.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export const normalizeCompanyKey = normalize;

export function useContactedCompanyKeys(): Set<string> {
  const { data } = useQuery({
    queryKey: ['contacted-company-keys'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('signals')
        .select('company_name')
        .or('status.eq.contacted,pipeline_status.in.(sent,replied)');
      if (error) throw error;
      return (rows ?? []).map((r) => normalize(r.company_name)).filter(Boolean);
    },
  });
  return useMemo(() => new Set(data ?? []), [data]);
}

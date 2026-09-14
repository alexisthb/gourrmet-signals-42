import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { collectAllPages } from '@/lib/supabasePagination';

export type SignalLocationIndex = {
  /** Localisation connue pour un signal précis (siège enrichi ou ville des contacts). */
  bySignal: Record<string, string>;
  /** Localisation connue pour une entreprise (repli par nom, source Pappers). */
  byCompany: Record<string, string>;
};

export function normalizeCompanyKey(name: string | null | undefined): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sa|sas|sasu|sarl|eurl|scop|groupe|group|france|holding)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Résout la localisation à afficher pour un signal : d'abord la donnée liée au
 * signal, sinon le repli par nom d'entreprise (fiches Pappers).
 */
export function resolveSignalLocation(
  index: SignalLocationIndex | undefined,
  signal: { id: string; company_name?: string | null },
): string | undefined {
  if (!index) return undefined;
  const direct = index.bySignal[signal.id];
  if (direct) return direct;
  const key = normalizeCompanyKey(signal.company_name);
  return key ? index.byCompany[key] : undefined;
}

/**
 * Localisation des sociétés pour les listes de signaux.
 *
 * Source 1 : company_enrichment.headquarters_location (siège renseigné par
 * l'enrichissement, désormais réalimenté depuis la résolution LinkedIn).
 * Source 2 : la ville majoritaire parmi les contacts du signal.
 * Source 3 (repli par nom) : la ville de la fiche Pappers de la même entreprise —
 * couvre les signaux Presse récents qui n'ont encore ni siège ni contact localisé.
 */
export function useSignalLocations() {
  return useQuery<SignalLocationIndex>({
    queryKey: ['signal-locations'],
    staleTime: 60_000,
    queryFn: async () => {
      const [enrichments, contacts, pappers] = await Promise.all([
        collectAllPages<{ signal_id: string | null; headquarters_location: string | null }>(
          (from, to) =>
            (supabase.from('company_enrichment') as any)
              .select('signal_id, headquarters_location')
              .not('headquarters_location', 'is', null)
              .order('signal_id', { ascending: true })
              .range(from, to),
        ),
        collectAllPages<{ signal_id: string | null; location: string | null }>((from, to) =>
          (supabase.from('contacts') as any)
            .select('signal_id, location')
            .not('location', 'is', null)
            .order('signal_id', { ascending: true })
            .range(from, to),
        ),
        collectAllPages<{ company_name: string | null; company_data: any }>((from, to) =>
          (supabase.from('pappers_signals') as any)
            .select('company_name, company_data')
            .order('id', { ascending: true })
            .range(from, to),
        ),
      ]);

      const bySignal: Record<string, string> = {};

      // Repli d'abord : ville majoritaire des contacts.
      const tallies = new Map<string, Map<string, number>>();
      for (const row of contacts || []) {
        const sid = row.signal_id;
        const loc = (row.location || '').trim();
        if (!sid || !loc) continue;
        const tally = tallies.get(sid) ?? new Map<string, number>();
        tally.set(loc, (tally.get(loc) ?? 0) + 1);
        tallies.set(sid, tally);
      }
      for (const [sid, tally] of tallies) {
        const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best) bySignal[sid] = best[0];
      }

      // Le siège renseigné prime sur le repli.
      for (const row of enrichments || []) {
        const sid = row.signal_id;
        const hq = (row.headquarters_location || '').trim();
        if (sid && hq) bySignal[sid] = hq;
      }

      // Index par nom d'entreprise depuis les fiches Pappers (ville officielle).
      const byCompany: Record<string, string> = {};
      for (const row of pappers || []) {
        const key = normalizeCompanyKey(row.company_name);
        if (!key || byCompany[key]) continue;
        const data = row.company_data && typeof row.company_data === 'object' ? row.company_data : {};
        const ville = typeof data.ville === 'string' ? data.ville.trim() : '';
        if (ville) byCompany[key] = ville;
      }

      return { bySignal, byCompany };
    },
  });
}

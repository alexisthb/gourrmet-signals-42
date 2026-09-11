import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { collectAllPages } from '@/lib/supabasePagination';

/**
 * Localisation des sociétés pour les listes de signaux.
 *
 * Source 1 : company_enrichment.headquarters_location (siège renseigné par
 * l'enrichissement). Ce champ n'est plus alimenté depuis le retrait de Manus
 * (mi-juillet 2026), d'où la disparition de la ville dans les listes Presse.
 * Source 2 (repli) : la ville la plus fréquente parmi les contacts du signal —
 * seule donnée géographique réellement disponible aujourd'hui.
 */
export function useSignalLocations() {
  return useQuery({
    queryKey: ['signal-locations'],
    staleTime: 60_000,
    queryFn: async () => {
      const [enrichments, contacts] = await Promise.all([
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

      return bySignal;
    },
  });
}

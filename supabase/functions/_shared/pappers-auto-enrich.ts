// Auto-enrichissement Manus des signaux Pappers >= 4★ (parité Presse).
//
// Partagé entre fetch-pappers (scans manuels / bouton app) et run-pappers-scan (cron 12h)
// pour un comportement IDENTIQUE des deux côtés. Étape POST-SCAN : transfère les N signaux
// >= min★ non encore traités et les met en file via enqueue-enrichment — qui applique déjà
// le gate pappers_enrichment_enabled, le dedup, le cooldown 24h et la garde crédits Manus.
// À appeler dans un try/catch par l'appelant : ne doit JAMAIS casser le scan.

import { isIcpLegalForm } from "./pappers-icp.ts";

async function getSetting(supabase: any, key: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    return data?.value ?? null;
  } catch (_e) {
    return null;
  }
}

// 1er nombre de la chaîne = borne basse de la tranche ("100 à 199 salariés" -> 100). NE PAS
// strip tous les non-chiffres (donnerait "100199" -> Grand Compte à tort).
export function pappersEstimatedSize(cd: any): string {
  const m = String(cd?.effectif ?? '').match(/\d+/);
  const n = m ? parseInt(m[0], 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 'Inconnu';
  if (n >= 5000) return 'Grand Compte';
  if (n >= 250) return 'ETI';
  return 'PME';
}

// Décision produit Gourmet : une PETITE entreprise ne doit JAMAIS être classée 4/5
// (star = round(relevance_score/20)) ni auto-enrichie (gate relevance_score >= minScore*20-10).
// Est "petite" une PME / Inconnu SANS CA costaud (< 5 M€). ETI, Grand Compte, ou CA >= 5 M€
// restent éligibles ("CA ou effectif costaud").
const SMALL_REVENUE_CAP = 5_000_000;
export function isSmallCompany(cd: any): boolean {
  const size = pappersEstimatedSize(cd);
  if (size === 'ETI' || size === 'Grand Compte') return false; // effectif costaud
  const ca = typeof cd?.chiffre_affaires === 'number' ? cd.chiffre_affaires : 0;
  return ca < SMALL_REVENUE_CAP; // PME/Inconnu avec CA faible ou inconnu => petite
}

// Plafonne le relevance_score (0-100) à 69 pour une petite entreprise => 3★ max ET sous le gate
// d'enrichissement (>= 70). À appliquer à CHAQUE calcul de relevance_score (scan + fetch).
export function capRelevanceForSmallCompany(cd: any, relevanceScore: number): number {
  return isSmallCompany(cd) ? Math.min(relevanceScore, 69) : relevanceScore;
}

// Mapping type Pappers -> taxonomie signals presse (miroir de useTransferToSignals côté front).
function pappersSignalType(t: string): string {
  return t === 'anniversary' ? 'anniversaire'
    : t === 'nomination' ? 'nomination'
    : t === 'capital_increase' ? 'levee'
    : t === 'transfer' ? 'expansion'
    : t === 'creation' ? 'creation'
    : 'levee';
}

export async function autoEnrichHighScorePappers(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
): Promise<void> {
  const enrichEnabled = await getSetting(supabase, 'pappers_enrichment_enabled');
  const autoEnabled = await getSetting(supabase, 'pappers_auto_enrich_enabled');
  // Master coupé (=='false') ou auto non explicitement activé -> on ne fait rien.
  if (enrichEnabled === 'false' || autoEnabled !== 'true') {
    console.log(`[pappers-auto-enrich] OFF (pappers_enrichment_enabled=${enrichEnabled}, pappers_auto_enrich_enabled=${autoEnabled}).`);
    return;
  }
  const minScore = parseInt((await getSetting(supabase, 'auto_enrich_min_score')) || '4', 10) || 4;
  const batch = parseInt((await getSetting(supabase, 'pappers_auto_enrich_batch')) || '10', 10) || 10;
  // star = round(relevance_score/20) >= minScore  <=>  relevance_score >= minScore*20 - 10
  const relThreshold = minScore * 20 - 10;

  const { data: rawCandidates, error } = await supabase
    .from('pappers_signals')
    .select('*')
    .eq('transferred_to_signals', false)
    .gte('relevance_score', relThreshold)
    .order('detected_at', { ascending: false })
    .limit(batch * 4); // sur-échantillonne pour écarter d'éventuels hors-ICP sans réduire le lot
  if (error) {
    console.error('[pappers-auto-enrich] select error:', error.message);
    return;
  }
  // Filet de sécurité ICP : ne jamais auto-enrichir une entité hors cible (0 contact garanti).
  const candidates = (rawCandidates || [])
    .filter((r: any) => isIcpLegalForm((r.company_data || {}).forme_juridique))
    // Filet taille : ne jamais auto-enrichir une petite entreprise (PME/Inconnu sans CA costaud),
    // même si un ancien relevance_score non plafonné l'avait fait passer le gate.
    .filter((r: any) => !isSmallCompany(r.company_data || {}))
    .slice(0, batch);
  if (candidates.length === 0) {
    console.log(`[pappers-auto-enrich] aucun signal >=${minScore}★ non transféré à traiter.`);
    return;
  }

  let enriched = 0;
  for (const row of candidates) {
    try {
      const cd = (row.company_data || {}) as Record<string, any>;
      const revenue = (typeof row.revenue === 'number' ? row.revenue : null)
        ?? (typeof cd.chiffre_affaires === 'number' ? cd.chiffre_affaires : null);
      const revenueSource = row.revenue_source ?? (revenue ? 'pappers' : null);

      const { data: newSignal, error: insErr } = await supabase
        .from('signals')
        .insert({
          company_name: row.company_name,
          signal_type: pappersSignalType(row.signal_type),
          event_detail: row.signal_detail,
          score: Math.max(1, Math.min(5, Math.round((row.relevance_score || 0) / 20))),
          source_name: 'Pappers',
          status: 'new',
          sector: (typeof cd.libelle_code_naf === 'string' ? cd.libelle_code_naf : null),
          estimated_size: pappersEstimatedSize(cd),
          revenue,
          revenue_source: revenueSource,
          detected_at: row.detected_at,
        })
        .select('id')
        .single();
      if (insErr || !newSignal) {
        console.error('[pappers-auto-enrich] insert signals error:', insErr?.message);
        continue;
      }

      await supabase.from('pappers_signals')
        .update({ transferred_to_signals: true, processed: true, signal_id: newSignal.id })
        .eq('id', row.id);

      // File d'enrichissement : enqueue-enrichment applique gate + dedup + cooldown + crédits.
      const resp = await fetch(`${supabaseUrl}/functions/v1/enqueue-enrichment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ signal_id: newSignal.id, job_type: 'contacts' }),
      });
      if (resp.ok) enriched++;
      else console.error('[pappers-auto-enrich] enqueue failed', resp.status, (await resp.text()).slice(0, 200));
    } catch (e) {
      console.error('[pappers-auto-enrich] row error:', e instanceof Error ? e.message : e);
    }
  }
  console.log(`[pappers-auto-enrich] ${enriched}/${candidates.length} signal(s) >=${minScore}★ transférés + mis en file (batch ${batch}).`);
}

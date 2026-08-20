// Auto-enrichissement Manus des signaux Pappers >= 4★ (parité Presse).
//
// Partagé entre fetch-pappers (scans manuels / bouton app) et run-pappers-scan (cron 12h)
// pour un comportement IDENTIQUE des deux côtés. Étape POST-SCAN : transfère les N signaux
// >= min★ non encore traités et les transfère + met en file via un unique RPC
// transactionnel. Un enqueue en échec conserve la liaison mais laisse la source à retraiter.
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

// Commerce de détail / gros (NAF 45 auto, 46 gros, 47 détail) à effectif NON "grand" :
// - le CA est un chiffre de FLUX (faible marge), pas un budget cadeaux d'affaires ;
// - ce sont souvent des sociétés d'EXPLOITATION locales / franchises dont le nom légal
//   (ex. "BRIEYDIS" = hypermarché de Briey) n'a AUCUNE page LinkedIn -> 0 contact possible.
// On ne les laisse donc pas passer 4/5 sur leur seul gros CA. On garde les grandes enseignes
// (Grand Compte = siège central) qui, elles, sont de vraies cibles.
const RETAIL_NAF_RE = /^(45|46|47)/;
export function isLowValueRetail(cd: any): boolean {
  const naf = String(cd?.code_naf ?? '').replace(/[^0-9]/g, '');
  if (!RETAIL_NAF_RE.test(naf)) return false;
  const size = pappersEstimatedSize(cd);
  return size === 'PME' || size === 'Inconnu';
}

// Plafonne le relevance_score (0-100) à 69 (=> 3★ max ET sous le gate d'enrichissement >= 70)
// pour les cibles FAIBLES : petite entreprise (PME/Inconnu sans CA costaud) OU commerce de
// détail/gros à faible effectif (CA de flux + souvent introuvable sur LinkedIn).
// À appliquer à CHAQUE calcul de relevance_score (scan + fetch).
export function capRelevanceForSmallCompany(cd: any, relevanceScore: number): number {
  return (isSmallCompany(cd) || isLowValueRetail(cd)) ? Math.min(relevanceScore, 69) : relevanceScore;
}

export function isPappersAutoEnrichmentEnabled(input: {
  generalAuto: string | null;
  pappersMaster: string | null;
  pappersAuto: string | null;
}): boolean {
  return input.generalAuto !== 'false'
    && input.pappersMaster !== 'false'
    && input.pappersAuto === 'true';
}

export async function autoEnrichHighScorePappers(
  supabase: any,
): Promise<void> {
  const generalAutoEnabled = await getSetting(supabase, 'auto_enrich_enabled');
  const enrichEnabled = await getSetting(supabase, 'pappers_enrichment_enabled');
  const autoEnabled = await getSetting(supabase, 'pappers_auto_enrich_enabled');
  // Le master général et le master Pappers bloquent explicitement sur `false` ;
  // l'auto Pappers doit, lui, être activé explicitement.
  if (!isPappersAutoEnrichmentEnabled({
    generalAuto: generalAutoEnabled,
    pappersMaster: enrichEnabled,
    pappersAuto: autoEnabled,
  })) {
    console.log(`[pappers-auto-enrich] OFF (auto_enrich_enabled=${generalAutoEnabled}, pappers_enrichment_enabled=${enrichEnabled}, pappers_auto_enrich_enabled=${autoEnabled}).`);
    return;
  }
  const minScore = parseInt((await getSetting(supabase, 'auto_enrich_min_score')) || '4', 10) || 4;
  const batch = parseInt((await getSetting(supabase, 'pappers_auto_enrich_batch')) || '10', 10) || 10;
  // star = round(relevance_score/20) >= minScore  <=>  relevance_score >= minScore*20 - 10
  const relThreshold = minScore * 20 - 10;

  const { data: rawCandidates, error } = await supabase
    .from('pappers_signals')
    .select('*')
    .eq('processed', false)
    .in('signal_type', ['anniversary', 'creation'])
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
    // Filet taille + retail : ne jamais auto-enrichir une petite entreprise (PME/Inconnu sans CA
    // costaud) ni un commerce de détail/gros à faible effectif (introuvable sur LinkedIn),
    // même si un ancien relevance_score non plafonné l'avait fait passer le gate.
    .filter((r: any) => !isSmallCompany(r.company_data || {}) && !isLowValueRetail(r.company_data || {}))
    .slice(0, batch);
  if (candidates.length === 0) {
    console.log(`[pappers-auto-enrich] aucun signal >=${minScore}★ non traité à prendre en charge.`);
    return;
  }

  let enriched = 0;
  for (const row of candidates) {
    try {
      const { data: handoff, error: handoffError } = await supabase.rpc(
        'transfer_and_enqueue_pappers_signal',
        { p_pappers_signal_id: row.id },
      );
      if (handoffError) {
        console.error('[pappers-auto-enrich] handoff RPC error:', handoffError.message);
        continue;
      }
      if (handoff?.processed === true) {
        enriched++;
      } else {
        console.error(
          '[pappers-auto-enrich] handoff incomplet, retry conservé',
          handoff?.enqueue_state || 'unknown',
          handoff?.enqueue?.error || '',
        );
      }
    } catch (e) {
      console.error('[pappers-auto-enrich] row error:', e instanceof Error ? e.message : e);
    }
  }
  console.log(`[pappers-auto-enrich] ${enriched}/${candidates.length} signal(s) >=${minScore}★ transférés + mis en file (batch ${batch}).`);
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Hardening audit: timeout 20s sur les appels Pappers + retry 2x sur 5xx/network.
const PAPPERS_FETCH_TIMEOUT_MS = 20_000;
const PAPPERS_MAX_RETRIES = 2;

async function pappersFetch(url: string): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= PAPPERS_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAPPERS_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      // Retry seulement sur 5xx
      if (res.status >= 500 && attempt < PAPPERS_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < PAPPERS_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Pappers fetch failed after retries');
}

interface PappersQuery {
  id: string;
  name: string;
  type: string;
  last_run_at: string | null;
  parameters: {
    region?: string;
    years?: number[];  // Années d'anniversaire (ex: [10] = 10 ans)
    months_ahead?: number;  // Mois à l'avance pour détecter (ex: 9 = dans 9 mois)
    min_employees?: string;
    min_revenue?: number;
    code_naf?: string[];
  };
}

interface PappersCompany {
  siren: string;
  denomination: string;
  date_creation: string;
  forme_juridique: string;
  effectif: string;
  tranche_effectif: string;
  chiffre_affaires?: number;
  code_naf?: string;
  libelle_code_naf?: string;
  siege?: {
    code_postal?: string;
    ville?: string;
    region?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY');
    if (!PAPPERS_API_KEY) {
      throw new Error('PAPPERS_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { queryId } = await req.json();
    
    console.log(`[fetch-pappers] Starting scan${queryId ? ` for query ${queryId}` : ' for all active queries'}`);

    // Get active queries
    let queriesQuery = supabase
      .from('pappers_queries')
      .select('*')
      .eq('is_active', true);
    
    if (queryId) {
      queriesQuery = queriesQuery.eq('id', queryId);
    }

    const { data: queries, error: queriesError } = await queriesQuery;

    if (queriesError) {
      throw new Error(`Failed to fetch queries: ${queriesError.message}`);
    }

    if (!queries || queries.length === 0) {
      console.log('[fetch-pappers] No active queries found');
      return new Response(JSON.stringify({ success: true, signalsCount: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSignals = 0;

    for (const query of queries as PappersQuery[]) {
      console.log(`[fetch-pappers] Processing query: ${query.name} (${query.type})`);

      try {
        const signals = await processQuery(query, PAPPERS_API_KEY, supabase);
        totalSignals += signals;

        // Update last_run_at
        await supabase
          .from('pappers_queries')
          .update({ 
            last_run_at: new Date().toISOString(),
            signals_count: query.parameters ? signals : 0
          })
          .eq('id', query.id);

      } catch (error) {
        console.error(`[fetch-pappers] Error processing query ${query.name}:`, error);
      }
    }

    console.log(`[fetch-pappers] Scan completed. Total signals: ${totalSignals}`);

    // Alerte précoce : un scan qui ne crée AUCUN signal sur des requêtes actives est le
    // symptôme exact de la panne « 0 signal Pappers depuis 4 mois » (format de date cassé).
    // Ce warning rend la panne visible dans les logs au lieu de passer inaperçue des mois.
    if (totalSignals === 0 && queries.length > 0) {
      console.warn(`[fetch-pappers] ⚠️ 0 signal créé sur ${queries.length} requête(s) active(s). À vérifier si cela persiste : format de date (JJ-MM-AAAA attendu par Pappers), clé PAPPERS_API_KEY, et seuils ICP (CA/effectif) éventuellement trop stricts.`);
    }

    return new Response(JSON.stringify({
      success: true, 
      signalsCount: totalSignals,
      queriesProcessed: queries.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[fetch-pappers] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processQuery(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { type, parameters } = query;

  if (type === 'anniversary') {
    return await searchAnniversaries(query, apiKey, supabase);
  } else if (type === 'nomination') {
    return await searchNominations(query, apiKey, supabase);
  } else if (type === 'capital_increase') {
    return await searchCapitalIncreases(query, apiKey, supabase);
  } else if (type === 'transfer') {
    return await searchTransfers(query, apiKey, supabase);
  } else if (type === 'creation') {
    return await searchCreations(query, apiKey, supabase);
  }

  // type='radiation' (et autres futurs types) : non implémenté, on log explicitement
  // plutôt que de retourner 0 en silence comme avant.
  console.warn(`[fetch-pappers] Query type '${type}' not implemented, skipping query ${query.id}`);
  return 0;
}

// PANNE PAPPERS « 0 signal depuis des mois » : l'API Pappers attend les dates au format
// JJ-MM-AAAA sur /recherche (date_creation_min/max), et NON AAAA-MM-JJ. run-pappers-scan
// avait été corrigé (cf. son formatDateForPappers + commentaire IMPORTANT) ; fetch-pappers,
// LE scanner réellement schedulé par le cron quotidien, ne l'était PAS -> l'API ne
// renvoyait rien -> aucun signal Pappers créé. Cette fonction rétablit le bon format.
function formatDateForPappers(dateStr: string): string {
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) return dateStr; // déjà JJ-MM-AAAA
  const p = dateStr.split('-');
  return (p.length === 3 && p[0].length === 4) ? `${p[2]}-${p[1]}-${p[0]}` : dateStr;
}

// BUG « 0 signal » (2e cause, indépendante du format de date) : l'UI stocke l'effectif
// minimum en NOMBRE BRUT ("10","20","50","100","250" — cf. Settings.tsx), mais l'API Pappers
// attend un CODE de tranche INSEE/Sirene sur tranche_effectif_min. Aucune des valeurs du
// menu déroulant n'est un code valide -> le filtre ne matche AUCUNE entreprise dès qu'un
// effectif min est réglé. Cette table convertit un effectif brut vers le bon code de tranche.
// Codes Sirene : 11=10-19, 12=20-49, 21=50-99, 22=100-199, 31=200-249, 32=250-499,
// 41=500-999, 42=1000-1999, 51=2000-4999, 52=5000-9999, 53=10000+.
function employeesToTrancheCode(minEmployees: number): string | null {
  if (!Number.isFinite(minEmployees) || minEmployees <= 0) return null;
  const bands: Array<[number, string]> = [
    [10000, '53'], [5000, '52'], [2000, '51'], [1000, '42'], [500, '41'],
    [250, '32'], [200, '31'], [100, '22'], [50, '21'], [20, '12'], [10, '11'],
    [6, '03'], [3, '02'], [1, '01'],
  ];
  for (const [lowerBound, code] of bands) {
    if (minEmployees >= lowerBound) return code;
  }
  return null;
}

// Scan incrémental auto-cicatrisant : nombre de jours de dates de création couverts à
// chaque passage (fenêtre glissante) au lieu d'un seul jour exact — voir searchAnniversaries.
const INCREMENTAL_WINDOW_DAYS = 35;

const PAPPERS_REVENUE_FLOOR = 1_000_000; // plancher CA par défaut (ICP premium), aligné sur run-pappers-scan

// Lit les seuils ICP : per-query sinon réglages globaux Settings
// (min_revenue_pappers / min_employees_pappers), avec un plancher CA par défaut de 1M€.
// Câble enfin ces réglages "fantômes" (écrits dans Settings mais lus par personne).
async function getPappersFloors(
  supabase: any,
  parameters: any,
): Promise<{ minRevenue: number; minEmployeesTranche: string | null }> {
  let globalRev = 0;
  let globalEmp: string | null = null;
  try {
    const { data: rev } = await supabase.from('settings').select('value').eq('key', 'min_revenue_pappers').maybeSingle();
    if (rev?.value) globalRev = parseInt(rev.value, 10) || 0;
    const { data: emp } = await supabase.from('settings').select('value').eq('key', 'min_employees_pappers').maybeSingle();
    if (emp?.value) globalEmp = String(emp.value);
  } catch (_e) { /* table settings absente -> valeurs par défaut */ }

  const queryRev = typeof parameters?.min_revenue === 'number' ? parameters.min_revenue : 0;
  const minRevenue = Math.max(globalRev, queryRev) || PAPPERS_REVENUE_FLOOR;
  // Effectif brut ("20") -> code de tranche INSEE ("12"). Sans cette conversion,
  // tranche_effectif_min recevait un nombre invalide et ne matchait aucune entreprise.
  const minEmpRaw = parseInt(String(parameters?.min_employees ?? globalEmp ?? ''), 10);
  const minEmployeesTranche = Number.isFinite(minEmpRaw) && minEmpRaw > 0
    ? employeesToTrancheCode(minEmpRaw)
    : null;
  return { minRevenue, minEmployeesTranche };
}

// Mois d'anticipation des anniversaires : per-query (months_ahead) sinon réglage global
// Settings (pappers_anticipation_months, câblé côté UI mais lu par personne jusqu'ici),
// sinon défaut 9 mois — laisse le temps d'identifier, contacter et livrer un cadeau avant
// la date d'anniversaire. Câble enfin ce réglage "fantôme".
async function getAnticipationMonths(supabase: any, parameters: any): Promise<number> {
  if (typeof parameters?.months_ahead === 'number' && parameters.months_ahead > 0) {
    return parameters.months_ahead;
  }
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'pappers_anticipation_months').maybeSingle();
    const n = parseInt(data?.value, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_e) { /* table settings absente -> défaut */ }
  return 9;
}

async function searchAnniversaries(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId, last_run_at } = query;
  const anniversaryYears = parameters.years || [10];  // Ex: 10 ans
  const monthsAhead = await getAnticipationMonths(supabase, parameters);  // Ex: dans 9 mois

  let signalsCreated = 0;
  const floors = await getPappersFloors(supabase, parameters);
  const today = new Date();
  
  // Calculer la date cible : aujourd'hui + X mois
  const targetDate = new Date(today);
  targetDate.setMonth(targetDate.getMonth() + monthsAhead);
  
  // Déterminer si c'est un premier scan ou un scan incrémental
  const isFirstRun = !last_run_at;
  
  for (const targetYears of anniversaryYears) {
    // Date de création = date cible - années d'anniversaire
    const creationYear = targetDate.getFullYear() - targetYears;
    const creationMonth = targetDate.getMonth();
    const creationDay = targetDate.getDate();
    
    let dateCreationMin: string;
    let dateCreationMax: string;
    
    if (isFirstRun) {
      // Premier scan : on prend TOUT le mois de création pour rattraper
      // Exemple : si anniversaire le 15/09/2035, on cherche créations en 09/2025
      dateCreationMin = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(creationYear, creationMonth + 1, 0).getDate();
      dateCreationMax = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      
      console.log(`[fetch-pappers] PREMIER SCAN - Entreprises créées en ${String(creationMonth + 1).padStart(2, '0')}/${creationYear} (anniversaire ${targetYears} ans dans ${monthsAhead} mois)`);
    } else {
      // Scan incrémental AUTO-CICATRISANT : au lieu d'UN seul jour exact (fragile — tout jour
      // manqué par le cron était perdu à jamais, et un scan mono-jour renvoie 0 la plupart du
      // temps car peu d'entreprises sont créées un jour donné il y a ~X ans), on couvre une
      // FENÊTRE glissante des INCREMENTAL_WINDOW_DAYS derniers jours de dates de création
      // cibles. Le dédup (siren, type) + l'index unique rendent le recouvrement idempotent.
      const targetCreation = new Date(creationYear, creationMonth, creationDay);
      const windowStart = new Date(targetCreation);
      windowStart.setDate(windowStart.getDate() - INCREMENTAL_WINDOW_DAYS);
      dateCreationMin = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, '0')}-${String(windowStart.getDate()).padStart(2, '0')}`;
      dateCreationMax = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-${String(creationDay).padStart(2, '0')}`;

      console.log(`[fetch-pappers] SCAN INCRÉMENTAL - Entreprises créées du ${dateCreationMin} au ${dateCreationMax} (fenêtre ${INCREMENTAL_WINDOW_DAYS}j, anniversaire ${targetYears} ans le ${targetDate.toISOString().split('T')[0]})`);
    }
    
    // Pagination pour récupérer tous les résultats
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    
    while (hasMore) {
      const params = new URLSearchParams({
        api_token: apiKey,
        date_creation_min: formatDateForPappers(dateCreationMin),
        date_creation_max: formatDateForPappers(dateCreationMax),
        per_page: String(perPage),
        page: String(page),
        statut: 'actif',
      });

      if (parameters.region && parameters.region !== 'all') {
        params.append('region', parameters.region);
      }

      if (floors.minEmployeesTranche) {
        params.append('tranche_effectif_min', floors.minEmployeesTranche);
      }

      // Diagnostic : log des filtres EXACTS envoyés (hors api_token) au 1er appel. Rend
      // immédiatement visible dans les logs tout filtre qui viderait le résultat (tranche,
      // région, dates) — ce qui manquait pour diagnostiquer les scans « 0 signal ».
      if (page === 1) {
        console.log(`[fetch-pappers] Filtres recherche → date_creation ${formatDateForPappers(dateCreationMin)}..${formatDateForPappers(dateCreationMax)} | region=${parameters.region ?? 'national'} | tranche_effectif_min=${floors.minEmployeesTranche ?? 'aucun'} | CA≥${floors.minRevenue}€`);
      }

      try {
        const response = await pappersFetch(
          `https://api.pappers.fr/v2/recherche?${params.toString()}`
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[fetch-pappers] Pappers API error: ${response.status} - ${errorText}`);
          hasMore = false;
          continue;
        }

        const data = await response.json();
        const companies: PappersCompany[] = data.resultats || [];
        const total = data.total || 0;

        console.log(`[fetch-pappers] Page ${page}: ${companies.length} entreprises (total: ${total})`);

        for (const company of companies) {
          // Vérifier si le signal existe déjà (par SIREN + type)
          const { data: existing } = await supabase
            .from('pappers_signals')
            .select('id')
            .eq('siren', company.siren)
            .eq('signal_type', 'anniversary')
            .maybeSingle();

          if (existing) continue;

          // Plancher CA (ICP premium) : on écarte les sociétés dont le CA connu est sous le
          // seuil. CA inconnu -> on laisse passer (ne pas pénaliser l'absence de donnée).
          if (typeof company.chiffre_affaires === 'number' && company.chiffre_affaires > 0 && company.chiffre_affaires < floors.minRevenue) {
            continue;
          }

          // Bonus d'ancienneté : un anniversaire rond (50, 100 ans...) est une occasion
          // de cadeau bien plus forte que la seule taille de l'entreprise. Sans ça, le
          // centenaire d'une PME (base 50 -> 3 étoiles) ressortait SOUS une simple
          // nomination (score fixe 70 -> 4 étoiles), ce qui n'a pas de sens métier.
          const score = Math.min(100, calculateRelevanceScore(company, parameters) + milestoneBonus(targetYears));

          // Calculer la date d'anniversaire exacte
          const anniversaryDate = new Date(company.date_creation);
          anniversaryDate.setFullYear(anniversaryDate.getFullYear() + targetYears);

          const { error: insertError } = await supabase
            .from('pappers_signals')
            .insert({
              query_id: queryId,
              company_name: company.denomination,
              siren: company.siren,
              signal_type: 'anniversary',
              signal_detail: `Fêtera ses ${targetYears} ans le ${anniversaryDate.toLocaleDateString('fr-FR')} (créée le ${new Date(company.date_creation).toLocaleDateString('fr-FR')})`,
              relevance_score: score,
              company_data: {
                date_creation: company.date_creation,
                anniversary_date: anniversaryDate.toISOString().split('T')[0],
                anniversary_years: targetYears,
                forme_juridique: company.forme_juridique,
                effectif: company.effectif || company.tranche_effectif,
                chiffre_affaires: company.chiffre_affaires,
                code_naf: company.code_naf,
                libelle_code_naf: company.libelle_code_naf,
                ville: company.siege?.ville,
                code_postal: company.siege?.code_postal,
                region: company.siege?.region,
              },
            });

          if (insertError) {
            console.error(`[fetch-pappers] Error inserting signal:`, insertError);
          } else {
            signalsCreated++;
          }
        }

        // Vérifier s'il y a plus de résultats
        hasMore = companies.length === perPage && (page * perPage) < total;
        page++;
        
        // Pause pour éviter de surcharger l'API
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

      } catch (error) {
        console.error(`[fetch-pappers] Error fetching anniversaries:`, error);
        hasMore = false;
      }
    }
  }

  console.log(`[fetch-pappers] Total signaux créés pour anniversaires: ${signalsCreated}`);
  return signalsCreated;
}

async function searchNominations(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId } = query;
  
  // Use BODACC publications for nominations
  const params = new URLSearchParams({
    api_token: apiKey,
    type_publication: 'modification',
    per_page: '50',
  });

  if (parameters.region && parameters.region !== 'all') {
    params.append('region', parameters.region);
  }

  console.log(`[fetch-pappers] Searching for recent nominations`);

  try {
    const response = await pappersFetch(
      `https://api.pappers.fr/v2/publications?${params.toString()}`
    );

    if (!response.ok) {
      console.error(`[fetch-pappers] Pappers API error: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    const publications = data.resultats || [];

    let signalsCreated = 0;

    for (const pub of publications) {
      // Filter for nominations (dirigeant changes)
      if (!pub.contenu?.includes('nomination') && !pub.contenu?.includes('dirigeant')) {
        continue;
      }

      const { data: existing } = await supabase
        .from('pappers_signals')
        .select('id')
        .eq('siren', pub.siren)
        .eq('signal_type', 'nomination')
        .gte('detected_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (existing) continue;

      const { error: insertError } = await supabase
        .from('pappers_signals')
        .insert({
          query_id: queryId,
          company_name: pub.denomination,
          siren: pub.siren,
          signal_type: 'nomination',
          signal_detail: `Changement de dirigeant publié au BODACC`,
          relevance_score: 70,
          company_data: {
            date_publication: pub.date_publication,
            type_publication: pub.type_publication,
          },
        });

      if (!insertError) signalsCreated++;
    }

    return signalsCreated;
  } catch (error) {
    console.error(`[fetch-pappers] Error fetching nominations:`, error);
    return 0;
  }
}

async function searchCapitalIncreases(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId } = query;
  
  const params = new URLSearchParams({
    api_token: apiKey,
    type_publication: 'modification',
    per_page: '50',
  });

  if (parameters.region && parameters.region !== 'all') {
    params.append('region', parameters.region);
  }

  console.log(`[fetch-pappers] Searching for capital increases`);

  try {
    const response = await pappersFetch(
      `https://api.pappers.fr/v2/publications?${params.toString()}`
    );

    if (!response.ok) {
      return 0;
    }

    const data = await response.json();
    const publications = data.resultats || [];

    let signalsCreated = 0;

    for (const pub of publications) {
      if (!pub.contenu?.includes('capital') && !pub.contenu?.includes('augmentation')) {
        continue;
      }

      const { data: existing } = await supabase
        .from('pappers_signals')
        .select('id')
        .eq('siren', pub.siren)
        .eq('signal_type', 'capital_increase')
        .gte('detected_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();

      if (existing) continue;

      const { error: insertError } = await supabase
        .from('pappers_signals')
        .insert({
          query_id: queryId,
          company_name: pub.denomination,
          siren: pub.siren,
          signal_type: 'capital_increase',
          signal_detail: `Augmentation de capital publiée au BODACC`,
          relevance_score: 75,
          company_data: {
            date_publication: pub.date_publication,
          },
        });

      if (!insertError) signalsCreated++;
    }

    return signalsCreated;
  } catch (error) {
    console.error(`[fetch-pappers] Error fetching capital increases:`, error);
    return 0;
  }
}

// Changement de siège (transfer) : on filtre les publications BODACC de type
// 'modification' contenant 'siège' ou 'transfert'. Dédup 7j par (SIREN, type).
async function searchTransfers(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId } = query;
  const params = new URLSearchParams({
    api_token: apiKey,
    type_publication: 'modification',
    per_page: '50',
  });
  if (parameters.region && parameters.region !== 'all') params.append('region', parameters.region);

  console.log(`[fetch-pappers] Searching for siège transfers`);
  try {
    const response = await pappersFetch(`https://api.pappers.fr/v2/publications?${params.toString()}`);
    if (!response.ok) return 0;
    const data = await response.json();
    const publications = data.resultats || [];
    let signalsCreated = 0;

    for (const pub of publications) {
      const contenu = (pub.contenu || '').toLowerCase();
      if (!contenu.includes('siège') && !contenu.includes('siege') && !contenu.includes('transfert')) continue;

      const { data: existing } = await supabase
        .from('pappers_signals')
        .select('id')
        .eq('siren', pub.siren)
        .eq('signal_type', 'transfer')
        .gte('detected_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle();
      if (existing) continue;

      const { error: insertError } = await supabase
        .from('pappers_signals')
        .insert({
          query_id: queryId,
          company_name: pub.denomination,
          siren: pub.siren,
          signal_type: 'transfer',
          signal_detail: `Transfert de siège publié au BODACC`,
          relevance_score: 65,
          company_data: { date_publication: pub.date_publication },
        });
      if (!insertError) signalsCreated++;
    }
    return signalsCreated;
  } catch (error) {
    console.error(`[fetch-pappers] Error fetching transfers:`, error);
    return 0;
  }
}

// Entreprises récemment créées : endpoint /recherche avec date_creation_min sur
// les N derniers jours (parameters.recent_days, défaut 30). Score basé sur le
// scoring standard (effectif, CA, NAF).
async function searchCreations(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId } = query;
  const recentDays = parameters.recent_days ?? 30;
  const floors = await getPappersFloors(supabase, parameters);
  const dateMin = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const params = new URLSearchParams({
    api_token: apiKey,
    per_page: '50',
    date_creation_min: formatDateForPappers(dateMin),
  });
  if (parameters.region && parameters.region !== 'all') params.append('region', parameters.region);
  if (floors.minEmployeesTranche) params.append('tranche_effectif_min', floors.minEmployeesTranche);

  console.log(`[fetch-pappers] Recherche créations depuis ${formatDateForPappers(dateMin)} | region=${parameters.region ?? 'national'} | tranche_effectif_min=${floors.minEmployeesTranche ?? 'aucun'} | CA≥${floors.minRevenue}€`);
  try {
    const response = await pappersFetch(`https://api.pappers.fr/v2/recherche?${params.toString()}`);
    if (!response.ok) {
      console.error(`[fetch-pappers] Pappers API error (créations): ${response.status} - ${(await response.text()).slice(0, 300)}`);
      return 0;
    }
    const data = await response.json();
    const companies: PappersCompany[] = data.resultats || [];
    let signalsCreated = 0;

    for (const company of companies) {
      const { data: existing } = await supabase
        .from('pappers_signals')
        .select('id')
        .eq('siren', company.siren)
        .eq('signal_type', 'creation')
        .maybeSingle();
      if (existing) continue;

      // Plancher CA (ICP premium) — même règle que les anniversaires.
      if (typeof company.chiffre_affaires === 'number' && company.chiffre_affaires > 0 && company.chiffre_affaires < floors.minRevenue) {
        continue;
      }

      const { error: insertError } = await supabase
        .from('pappers_signals')
        .insert({
          query_id: queryId,
          company_name: company.denomination,
          siren: company.siren,
          signal_type: 'creation',
          signal_detail: `Entreprise créée le ${new Date(company.date_creation).toLocaleDateString('fr-FR')}`,
          relevance_score: calculateRelevanceScore(company, parameters),
          company_data: {
            date_creation: company.date_creation,
            forme_juridique: company.forme_juridique,
            effectif: company.effectif,
          },
        });
      if (!insertError) signalsCreated++;
    }
    return signalsCreated;
  } catch (error) {
    console.error(`[fetch-pappers] Error fetching creations:`, error);
    return 0;
  }
}

// Bonus selon l'ampleur de l'anniversaire (plus c'est rond/ancien, plus l'occasion
// de cadeau est forte). Échelle calée pour qu'un centenaire ressorte au moins à 4★.
function milestoneBonus(years: number): number {
  if (years >= 100) return 35;
  if (years >= 50) return 30;
  if (years >= 25) return 22;
  if (years >= 20) return 18;
  if (years >= 10) return 12;
  return 6;
}

function calculateRelevanceScore(company: PappersCompany, parameters: any): number {
  let score = 50; // Base score

  // Bonus for larger companies
  const effectif = company.effectif || company.tranche_effectif || '';
  if (effectif.includes('250') || effectif.includes('500') || effectif.includes('1000')) {
    score += 25;
  } else if (effectif.includes('100') || effectif.includes('200')) {
    score += 20;
  } else if (effectif.includes('50')) {
    score += 15;
  } else if (effectif.includes('20')) {
    score += 10;
  }

  // Bonus for revenue
  if (company.chiffre_affaires) {
    if (company.chiffre_affaires > 50000000) score += 20;
    else if (company.chiffre_affaires > 10000000) score += 15;
    else if (company.chiffre_affaires > 5000000) score += 10;
  }

  // Bonus for relevant sectors (luxury, food, events, etc.)
  const nafCode = company.code_naf || '';
  const relevantSectors = ['56', '47', '70', '82', '93']; // Restauration, commerce, conseil, services admin, loisirs
  if (relevantSectors.some(s => nafCode.startsWith(s))) {
    score += 10;
  }

  return Math.min(score, 100);
}

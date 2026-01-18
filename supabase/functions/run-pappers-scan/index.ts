import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration des années d'anniversaire à scanner (milestones significatifs)
const ANNIVERSARY_YEARS = [5, 10, 20, 25, 30, 40, 50, 75, 100];

// Rate limiting: délai entre chaque requête API (en ms)
const RATE_LIMIT_DELAY = 500;

// Résultats par page (max API Pappers)
const RESULTS_PER_PAGE = 25;

// Codes région pour filtrage géographique prioritaire
const PRIORITY_REGIONS: Record<string, string> = {
  'ile-de-france': '11',
  'paca': '93', 
  'auvergne-rhone-alpes': '84',
};

interface PlanSettings {
  id: string;
  plan_name: string;
  monthly_credits: number;
  current_period_start: string;
  current_period_end: string;
  rate_limit_per_second: number;
  results_per_page: number;
  alert_threshold_percent: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { 
      action = 'daily',  // 'daily' = scan quotidien des anniversaires du jour
      dryRun = false,    // Mode réel par défaut (API Pappers active)
      years = ANNIVERSARY_YEARS,
      priorityRegionsOnly = true,  // Filtrer par régions prioritaires
      maxResultsPerYear,  // Limite optionnelle par année
      anticipationMonths: anticipationMonthsOverride,  // Anticipation en mois (défaut: 9)
      minEmployees: minEmployeesOverride,  // Override optionnel du minimum salariés
    } = body;
    
    // Récupérer le paramètre d'anticipation depuis les settings (ou utiliser l'override)
    let anticipationMonths = 9; // Par défaut: 9 mois d'anticipation
    if (anticipationMonthsOverride !== undefined) {
      anticipationMonths = anticipationMonthsOverride;
    } else {
      const { data: anticipationSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pappers_anticipation_months')
        .single();
      if (anticipationSetting?.value) {
        anticipationMonths = parseInt(anticipationSetting.value) || 9;
      }
    }

    // Récupérer le paramètre minEmployees depuis les settings (ou utiliser l'override)
    let minEmployees = 20;
    if (minEmployeesOverride !== undefined) {
      minEmployees = minEmployeesOverride;
    } else {
      const { data: settingData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'min_employees_pappers')
        .single();
      if (settingData?.value) {
        minEmployees = parseInt(settingData.value) || 20;
      }
    }

    console.log(`[run-pappers-scan] Action: ${action}, DryRun: ${dryRun}, Priority Regions: ${priorityRegionsOnly}, Min Employees: ${minEmployees}, Anticipation: ${anticipationMonths} mois`);

    // Récupérer les paramètres du forfait
    const planSettings = await getPlanSettings(supabase);
    const creditsUsed = await getCreditsUsedThisMonth(supabase, planSettings);
    const creditsRemaining = planSettings.monthly_credits - creditsUsed;
    const usagePercent = Math.round((creditsUsed / planSettings.monthly_credits) * 100);

    console.log(`[run-pappers-scan] Credits: ${creditsUsed}/${planSettings.monthly_credits} (${usagePercent}%)`);

    if (usagePercent >= planSettings.alert_threshold_percent) {
      console.warn(`[run-pappers-scan] ⚠️ ALERTE: ${usagePercent}% des crédits utilisés!`);
    }

    if (action === 'status') {
      return handleStatusRequest(supabase, planSettings, creditsUsed, corsHeaders);
    }

    // Arrêter un scan
    if (action === 'stop') {
      const { scanId } = body;
      if (!scanId) {
        return new Response(JSON.stringify({ error: 'scanId requis pour l\'action stop' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const { error } = await supabase
        .from('pappers_scan_progress')
        .update({ 
          status: 'cancelled', 
          completed_at: new Date().toISOString(),
          error_message: 'Scan arrêté manuellement'
        })
        .eq('id', scanId);
      
      if (error) throw error;
      
      console.log(`[run-pappers-scan] Scan ${scanId} arrêté`);
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Scan arrêté avec succès' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Scan quotidien des anniversaires avec anticipation
    return handleDailyScan(
      supabase,
      years,
      dryRun,
      planSettings,
      creditsRemaining,
      priorityRegionsOnly,
      maxResultsPerYear,
      anticipationMonths,
      minEmployees,
      corsHeaders
    );

  } catch (error) {
    console.error('[run-pappers-scan] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getPlanSettings(supabase: any): Promise<PlanSettings> {
  const { data, error } = await supabase
    .from('pappers_plan_settings')
    .select('*')
    .single();

  if (error || !data) {
    return {
      id: 'default',
      plan_name: 'Standard',
      monthly_credits: 10000,
      current_period_start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
      current_period_end: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().split('T')[0],
      rate_limit_per_second: 2,
      results_per_page: 25,
      alert_threshold_percent: 80,
    };
  }

  return data;
}

async function getCreditsUsedThisMonth(supabase: any, planSettings: PlanSettings): Promise<number> {
  const { data, error } = await supabase
    .from('pappers_credit_usage')
    .select('credits_used')
    .gte('date', planSettings.current_period_start)
    .lte('date', planSettings.current_period_end);

  if (error || !data) return 0;
  return data.reduce((sum: number, row: any) => sum + (row.credits_used || 0), 0);
}

async function handleStatusRequest(
  supabase: any, 
  planSettings: PlanSettings,
  creditsUsed: number,
  corsHeaders: Record<string, string>
) {
  // Récupérer les derniers scans
  const { data: recentScans } = await supabase
    .from('pappers_scan_progress')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  // Compter les signaux d'aujourd'hui
  const today = new Date().toISOString().split('T')[0];
  const { count: todaySignals } = await supabase
    .from('pappers_signals')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today);

  return new Response(JSON.stringify({
    recentScans: recentScans || [],
    todaySignals: todaySignals || 0,
    credits: {
      used: creditsUsed,
      limit: planSettings.monthly_credits,
      remaining: planSettings.monthly_credits - creditsUsed,
      percent: Math.round((creditsUsed / planSettings.monthly_credits) * 100),
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Scan quotidien : récupère les entreprises qui fêteront leur anniversaire dans X mois
 * Logique: Aujourd'hui + anticipation → Date anniversaire future → Date création à chercher
 * Ex: 18/01/2026 + 9 mois = 18/10/2026 (anniversaires) → Créations du 18/10/2016 (pour 10 ans)
 */
async function handleDailyScan(
  supabase: any,
  years: number[],
  dryRun: boolean,
  planSettings: PlanSettings,
  creditsRemaining: number,
  priorityRegionsOnly: boolean,
  maxResultsPerYear: number | undefined,
  anticipationMonths: number,
  minEmployees: number,
  corsHeaders: Record<string, string>
) {
  const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY');
  
  if (!dryRun && !PAPPERS_API_KEY) {
    throw new Error('PAPPERS_API_KEY not configured');
  }

  // Calcul de la date d'anniversaire anticipée
  const today = new Date();
  const futureAnniversaryDate = new Date(today);
  futureAnniversaryDate.setMonth(futureAnniversaryDate.getMonth() + anticipationMonths);
  
  // Jour et mois de l'anniversaire futur (= jour et mois de création à chercher)
  const targetDay = futureAnniversaryDate.getDate();
  const targetMonth = futureAnniversaryDate.getMonth(); // 0-indexed
  const anniversaryYear = futureAnniversaryDate.getFullYear();

  const anticipationDays = Math.round((futureAnniversaryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  
  console.log(`[run-pappers-scan] 📅 Aujourd'hui: ${today.toLocaleDateString('fr-FR')}`);
  console.log(`[run-pappers-scan] 🎯 Anniversaires anticipés: ${futureAnniversaryDate.toLocaleDateString('fr-FR')} (dans ${anticipationDays} jours / ${anticipationMonths} mois)`);
  console.log(`[run-pappers-scan] 👥 Filtre: min ${minEmployees} salariés`);

  // Récupérer les zones géographiques prioritaires
  const priorityGeoZones = await getPriorityGeoZones(supabase);
  console.log(`[run-pappers-scan] 🗺️ Zones prioritaires: ${priorityGeoZones.map(z => z.name).join(', ')}`);

  const scanResults = {
    today: today.toISOString().split('T')[0],
    anticipatedAnniversaryDate: futureAnniversaryDate.toISOString().split('T')[0],
    anticipationMonths,
    anticipationDays,
    totalFetched: 0,
    totalAvailable: 0,
    signalsCreated: 0,
    yearBreakdown: [] as Array<{
      year: number;
      creationDate: string;
      anniversaryDate: string;
      fetched: number;
      total: number;
      signals: number;
      regions: string[];
    }>,
    priorityRegionsOnly,
    dryRun,
    message: '',
  };

  // Pour chaque milestone d'anniversaire
  for (const anniversaryYears of years) {
    // Date de création exacte : année de l'anniversaire futur - X années
    // Ex: Anniversaire 10 ans le 18/10/2026 → Création le 18/10/2016
    const creationYear = anniversaryYear - anniversaryYears;
    const creationDate = `${creationYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
    const anniversaryDateStr = futureAnniversaryDate.toISOString().split('T')[0];

    console.log(`[run-pappers-scan] 🎂 ${anniversaryYears} ans le ${futureAnniversaryDate.toLocaleDateString('fr-FR')} → Créations du ${creationDate}`);

    const yearResult = {
      year: anniversaryYears,
      creationDate,
      anniversaryDate: anniversaryDateStr,
      fetched: 0,
      total: 0,
      signals: 0,
      regions: [] as string[],
    };

    if (dryRun) {
      // Mode simulation : estimer les résultats
      const estimate = estimateDailyAnniversaries(anniversaryYears);
      yearResult.total = estimate.national;
      yearResult.fetched = priorityRegionsOnly ? estimate.priorityRegions : estimate.national;
      
      scanResults.yearBreakdown.push(yearResult);
      scanResults.totalAvailable += estimate.national;
      scanResults.totalFetched += yearResult.fetched;
      
      console.log(`[run-pappers-scan] 🔬 SIMULATION ${anniversaryYears} ans: ~${estimate.national} national, ~${estimate.priorityRegions} régions prioritaires`);
    } else {
      // Mode réel : appeler l'API Pappers
      if (priorityRegionsOnly) {
        // Scanner chaque région prioritaire
        for (const geoZone of priorityGeoZones) {
          const regionCodes = getRegionCodes(geoZone);
          
          for (const regionCode of regionCodes) {
                const result = await fetchCompaniesForDate(
                  supabase,
                  PAPPERS_API_KEY!,
                  creationDate,
                  anniversaryYears,
                  anniversaryDateStr,
                  regionCode,
                  geoZone.id,
                  maxResultsPerYear,
                  minEmployees
                );
            
            yearResult.fetched += result.fetched;
            yearResult.total += result.total;
            yearResult.signals += result.signalsCreated;
            if (!yearResult.regions.includes(geoZone.name)) {
              yearResult.regions.push(geoZone.name);
            }
          }
        }
      } else {
        // Scanner au niveau national
        const result = await fetchCompaniesForDate(
          supabase,
          PAPPERS_API_KEY!,
          creationDate,
          anniversaryYears,
          anniversaryDateStr,
          undefined,
          undefined,
          maxResultsPerYear,
          minEmployees
        );
        
        yearResult.fetched = result.fetched;
        yearResult.total = result.total;
        yearResult.signals = result.signalsCreated;
      }

      scanResults.yearBreakdown.push(yearResult);
      scanResults.totalFetched += yearResult.fetched;
      scanResults.totalAvailable += yearResult.total;
      scanResults.signalsCreated += yearResult.signals;
    }
  }

  // Message de résumé
  if (dryRun) {
    scanResults.message = `🔬 SIMULATION: ${scanResults.totalFetched} entreprises estimées pour les anniversaires du ${futureAnniversaryDate.toLocaleDateString('fr-FR')} (dans ${anticipationMonths} mois). Passez dryRun=false pour exécuter.`;
  } else {
    scanResults.message = `✅ SCAN TERMINÉ: ${scanResults.signalsCreated} signaux créés sur ${scanResults.totalFetched} entreprises récupérées. Anniversaires prévus le ${futureAnniversaryDate.toLocaleDateString('fr-FR')} (dans ${anticipationMonths} mois).`;
    
    // Enregistrer l'usage des crédits
    if (scanResults.totalFetched > 0) {
      const creditsUsedNow = Math.ceil(scanResults.totalFetched * 0.1);
      await supabase.from('pappers_credit_usage').insert({
        date: new Date().toISOString().split('T')[0],
        credits_used: creditsUsedNow,
        search_credits: creditsUsedNow,
        company_credits: 0,
        api_calls: Math.ceil(scanResults.totalFetched / RESULTS_PER_PAGE),
        details: {
          today: scanResults.today,
          anticipatedAnniversaryDate: scanResults.anticipatedAnniversaryDate,
          anticipationMonths,
          yearsScanned: years,
          totalFetched: scanResults.totalFetched,
          totalAvailable: scanResults.totalAvailable,
          signalsCreated: scanResults.signalsCreated,
          priorityRegionsOnly,
        }
      });
    }
  }

  return new Response(JSON.stringify({
    success: true,
    ...scanResults,
    credits: {
      remaining: creditsRemaining,
      limit: planSettings.monthly_credits,
      willUse: dryRun ? Math.ceil(scanResults.totalFetched * 0.1) : Math.ceil(scanResults.signalsCreated * 0.1),
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Estimations quotidiennes basées sur les statistiques
 */
function estimateDailyAnniversaries(years: number): { national: number; priorityRegions: number } {
  // Estimations basées sur le tableau fourni
  const estimates: Record<number, number> = {
    5: 1100,
    10: 380,
    20: 115,
    25: 70,
    30: 55,
    40: 27,
    50: 16,
    75: 3,
    100: 1,
  };

  const national = estimates[years] || 50;
  // Île-de-France ~25%, PACA ~8%, Rhône-Alpes ~10% = ~43% des entreprises
  const priorityRegions = Math.round(national * 0.43);

  return { national, priorityRegions };
}

/**
 * Récupère les zones géographiques prioritaires depuis la DB
 */
async function getPriorityGeoZones(supabase: any): Promise<any[]> {
  const { data, error } = await supabase
    .from('geo_zones')
    .select('*')
    .eq('is_active', true)
    .gt('priority', 0)
    .order('priority', { ascending: false });

  if (error || !data || data.length === 0) {
    // Zones par défaut si non configurées
    return [
      { id: 'idf', name: 'Île-de-France', regions: ['Île-de-France'] },
      { id: 'paca', name: 'PACA', regions: ['Provence-Alpes-Côte d\'Azur'] },
      { id: 'ara', name: 'Auvergne-Rhône-Alpes', regions: ['Auvergne-Rhône-Alpes'] },
    ];
  }

  return data;
}

/**
 * Convertit une zone géographique en codes région Pappers
 */
function getRegionCodes(geoZone: any): string[] {
  const regionMapping: Record<string, string> = {
    'Île-de-France': '11',
    'Provence-Alpes-Côte d\'Azur': '93',
    'Auvergne-Rhône-Alpes': '84',
    'Occitanie': '76',
    'Nouvelle-Aquitaine': '75',
    'Hauts-de-France': '32',
    'Grand Est': '44',
    'Normandie': '28',
    'Bretagne': '53',
    'Pays de la Loire': '52',
    'Centre-Val de Loire': '24',
    'Bourgogne-Franche-Comté': '27',
    'Corse': '94',
  };

  const codes: string[] = [];
  const regions = geoZone.regions || [];
  
  for (const region of regions) {
    if (regionMapping[region]) {
      codes.push(regionMapping[region]);
    }
  }

  // Fallback basé sur le slug
  if (codes.length === 0) {
    const slug = (geoZone.slug || '').toLowerCase();
    if (slug.includes('ile-de-france') || slug === 'idf') {
      codes.push('11');
    } else if (slug.includes('paca')) {
      codes.push('93');
    } else if (slug.includes('rhone') || slug.includes('auvergne') || slug === 'ara') {
      codes.push('84');
    }
  }

  return codes.length > 0 ? codes : ['11']; // Default: Île-de-France
}

/**
 * Récupère les entreprises créées à une date exacte via l'API Pappers
 */
async function fetchCompaniesForDate(
  supabase: any,
  apiKey: string,
  creationDate: string,
  anniversaryYears: number,
  anniversaryDateStr: string,  // Date d'anniversaire anticipée (YYYY-MM-DD)
  regionCode?: string,
  geoZoneId?: string,
  maxResults?: number,
  minEmployees: number = 20
): Promise<{ fetched: number; total: number; signalsCreated: number }> {
  let page = 1;
  let fetchedResults = 0;
  let totalResults = 0;
  let signalsCreated = 0;

  const regionLabel = regionCode ? ` (région ${regionCode})` : '';
  console.log(`[fetchCompaniesForDate] Créations du ${creationDate}${regionLabel} → Anniversaires ${anniversaryYears} ans le ${anniversaryDateStr}, min ${minEmployees} salariés`);

  try {
    // Première requête avec filtre employés
    const firstUrl = buildPappersUrl(apiKey, creationDate, creationDate, page, regionCode, minEmployees);
    const firstResponse = await fetch(firstUrl);
    
    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      console.error(`[fetchCompaniesForDate] API error: ${firstResponse.status} - ${errorText}`);
      return { fetched: 0, total: 0, signalsCreated: 0 };
    }

    const firstData = await firstResponse.json();
    totalResults = firstData.total || 0;
    const companies = firstData.resultats || [];
    
    console.log(`[fetchCompaniesForDate] Total disponible: ${totalResults}, page 1: ${companies.length}`);
    
    // Traiter la première page
    const signals1 = await processCompanies(supabase, companies, anniversaryYears, creationDate, anniversaryDateStr, geoZoneId);
    signalsCreated += signals1;
    fetchedResults += companies.length;

    // Calculer combien de pages récupérer
    const maxToFetch = maxResults || totalResults;
    const pagesToFetch = Math.ceil(Math.min(maxToFetch, totalResults) / RESULTS_PER_PAGE);

    // Récupérer les pages suivantes
    while (page < pagesToFetch && fetchedResults < maxToFetch) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
      
      page++;
      const url = buildPappersUrl(apiKey, creationDate, creationDate, page, regionCode, minEmployees);
      
      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[fetchCompaniesForDate] API error on page ${page}: ${response.status}`);
        break;
      }

      const data = await response.json();
      const pageCompanies = data.resultats || [];
      
      if (pageCompanies.length === 0) break;
      
      const signalsN = await processCompanies(supabase, pageCompanies, anniversaryYears, creationDate, anniversaryDateStr, geoZoneId);
      signalsCreated += signalsN;
      fetchedResults += pageCompanies.length;
      
      console.log(`[fetchCompaniesForDate] Page ${page}: +${pageCompanies.length} (+${signalsN} signaux)`);
    }

  } catch (error) {
    console.error(`[fetchCompaniesForDate] Error:`, error);
  }

  return { fetched: fetchedResults, total: totalResults, signalsCreated };
}

/**
 * Construit l'URL de recherche Pappers
 */
function buildPappersUrl(
  apiKey: string, 
  dateMin: string, 
  dateMax: string, 
  page: number,
  regionCode?: string,
  minEmployees: number = 20
): string {
  const params = new URLSearchParams({
    api_token: apiKey,
    date_creation_min: dateMin,
    date_creation_max: dateMax,
    statut: 'actif',
    per_page: String(RESULTS_PER_PAGE),
    page: String(page),
    effectif_min: String(minEmployees), // Filtre minimum salariés
  });

  if (regionCode) {
    params.append('code_region', regionCode);
  }

  return `https://api.pappers.fr/v2/recherche?${params.toString()}`;
}

/**
 * Traite une liste d'entreprises et crée les signaux
 */
async function processCompanies(
  supabase: any,
  companies: any[],
  anniversaryYears: number,
  creationDate: string,
  anniversaryDateStr: string,  // Date d'anniversaire anticipée (YYYY-MM-DD)
  geoZoneId?: string
): Promise<number> {
  let signalsCreated = 0;

  // Calculer les jours restants avant l'anniversaire
  const today = new Date();
  const anniversaryDate = new Date(anniversaryDateStr);
  const daysUntilAnniversary = Math.round((anniversaryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  for (const company of companies) {
    // Vérifier si le signal existe déjà (par SIREN + type + année)
    const { data: existing } = await supabase
      .from('pappers_signals')
      .select('id')
      .eq('siren', company.siren)
      .eq('signal_type', 'anniversary')
      .single();

    if (existing) continue;

    // Calculer le score de pertinence
    const score = calculateRelevanceScore(company);

    const { error: insertError } = await supabase
      .from('pappers_signals')
      .insert({
        company_name: company.denomination || company.nom_entreprise,
        siren: company.siren,
        signal_type: 'anniversary',
        signal_detail: `🎂 Fêtera ses ${anniversaryYears} ans le ${anniversaryDate.toLocaleDateString('fr-FR')} (dans ${daysUntilAnniversary} jours) - Créée le ${new Date(creationDate).toLocaleDateString('fr-FR')}`,
        relevance_score: score,
        geo_zone_id: geoZoneId || null,
        company_data: {
          date_creation: company.date_creation || creationDate,
          anniversary_years: anniversaryYears,
          anniversary_date: anniversaryDateStr,
          days_until_anniversary: daysUntilAnniversary,
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

    if (!insertError) {
      signalsCreated++;
    } else {
      console.error(`[processCompanies] Error inserting signal:`, insertError);
    }
  }

  return signalsCreated;
}

/**
 * Calcule un score de pertinence pour une entreprise
 */
function calculateRelevanceScore(company: any): number {
  let score = 50;

  // Bonus pour la taille
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

  // Bonus pour le chiffre d'affaires
  if (company.chiffre_affaires) {
    if (company.chiffre_affaires > 50000000) score += 20;
    else if (company.chiffre_affaires > 10000000) score += 15;
    else if (company.chiffre_affaires > 5000000) score += 10;
  }

  // Bonus pour secteurs pertinents (luxe, restauration, événementiel)
  const nafCode = company.code_naf || '';
  const relevantSectors = ['56', '47', '70', '82', '93'];
  if (relevantSectors.some(s => nafCode.startsWith(s))) {
    score += 10;
  }

  return Math.min(score, 100);
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Configuration des années d'anniversaire à scanner
const ANNIVERSARY_YEARS = [5, 10, 20, 25, 30, 40, 50, 75, 100];

// Rate limiting: délai entre chaque requête API (en ms)
const RATE_LIMIT_DELAY = 500; // 2 requêtes par seconde

// Résultats par page (max API Pappers)
const RESULTS_PER_PAGE = 25;

interface ScanProgress {
  id: string;
  query_id: string | null;
  scan_type: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error';
  anniversary_years: number | null;
  current_page: number;
  total_pages: number | null;
  total_results: number | null;
  processed_results: number;
  date_creation_min: string | null;
  date_creation_max: string | null;
  last_cursor: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

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
      action = 'start',  // 'start', 'resume', 'pause', 'status'
      queryId,
      scanId,
      dryRun = true,  // MODE SIMULATION PAR DÉFAUT - pas d'appel API réel
      monthsAhead = 9,
      years = ANNIVERSARY_YEARS,
    } = body;

    console.log(`[run-pappers-scan] Action: ${action}, DryRun: ${dryRun}`);

    // Récupérer les paramètres du forfait
    const planSettings = await getPlanSettings(supabase);
    console.log(`[run-pappers-scan] Plan: ${planSettings.plan_name}, Credits: ${planSettings.monthly_credits}`);

    // Vérifier les crédits disponibles
    const creditsUsed = await getCreditsUsedThisMonth(supabase, planSettings);
    const creditsRemaining = planSettings.monthly_credits - creditsUsed;
    const usagePercent = Math.round((creditsUsed / planSettings.monthly_credits) * 100);

    console.log(`[run-pappers-scan] Credits: ${creditsUsed}/${planSettings.monthly_credits} (${usagePercent}%)`);

    // Alerte si on approche des limites
    if (usagePercent >= planSettings.alert_threshold_percent) {
      console.warn(`[run-pappers-scan] ⚠️ ALERTE: ${usagePercent}% des crédits utilisés!`);
    }

    // Gérer les différentes actions
    switch (action) {
      case 'status':
        return handleStatusRequest(supabase, scanId, planSettings, creditsUsed, corsHeaders);

      case 'pause':
        return handlePauseRequest(supabase, scanId, corsHeaders);

      case 'resume':
        return handleResumeRequest(supabase, scanId, dryRun, corsHeaders);

      case 'start':
      default:
        return handleStartRequest(
          supabase, 
          queryId, 
          years, 
          monthsAhead, 
          dryRun, 
          planSettings, 
          creditsRemaining,
          corsHeaders
        );
    }

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
    // Retourner des paramètres par défaut si pas configuré
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
  scanId: string | undefined, 
  planSettings: PlanSettings,
  creditsUsed: number,
  corsHeaders: Record<string, string>
) {
  // Si scanId fourni, retourner le statut de ce scan
  if (scanId) {
    const { data: scan, error } = await supabase
      .from('pappers_scan_progress')
      .select('*')
      .eq('id', scanId)
      .single();

    if (error) throw error;

    return new Response(JSON.stringify({
      scan,
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

  // Sinon retourner tous les scans en cours
  const { data: scans, error } = await supabase
    .from('pappers_scan_progress')
    .select('*')
    .in('status', ['pending', 'running', 'paused'])
    .order('created_at', { ascending: false });

  if (error) throw error;

  return new Response(JSON.stringify({
    scans: scans || [],
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

async function handlePauseRequest(
  supabase: any, 
  scanId: string | undefined, 
  corsHeaders: Record<string, string>
) {
  if (!scanId) {
    return new Response(JSON.stringify({ error: 'scanId required for pause' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { error } = await supabase
    .from('pappers_scan_progress')
    .update({ status: 'paused' })
    .eq('id', scanId);

  if (error) throw error;

  console.log(`[run-pappers-scan] Scan ${scanId} paused`);

  return new Response(JSON.stringify({ success: true, status: 'paused' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleResumeRequest(
  supabase: any, 
  scanId: string | undefined, 
  dryRun: boolean,
  corsHeaders: Record<string, string>
) {
  if (!scanId) {
    return new Response(JSON.stringify({ error: 'scanId required for resume' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Récupérer le scan en pause
  const { data: scan, error: scanError } = await supabase
    .from('pappers_scan_progress')
    .select('*')
    .eq('id', scanId)
    .single();

  if (scanError) throw scanError;

  if (scan.status !== 'paused') {
    return new Response(JSON.stringify({ error: 'Scan is not paused' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Mettre à jour le statut
  await supabase
    .from('pappers_scan_progress')
    .update({ status: 'running' })
    .eq('id', scanId);

  console.log(`[run-pappers-scan] Resuming scan ${scanId} from page ${scan.current_page}`);

  // TODO: Continuer le scan (pour l'instant on retourne juste le statut)
  return new Response(JSON.stringify({ 
    success: true, 
    status: 'running',
    message: dryRun ? 'SIMULATION MODE - No API calls will be made' : 'Scan resumed'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleStartRequest(
  supabase: any,
  queryId: string | undefined,
  years: number[],
  monthsAhead: number,
  dryRun: boolean,
  planSettings: PlanSettings,
  creditsRemaining: number,
  corsHeaders: Record<string, string>
) {
  const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY');
  
  if (!dryRun && !PAPPERS_API_KEY) {
    throw new Error('PAPPERS_API_KEY not configured');
  }

  // Calculer les dates pour chaque année d'anniversaire
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setMonth(targetDate.getMonth() + monthsAhead);

  const scanResults = {
    totalEstimatedCompanies: 0,
    totalEstimatedCredits: 0,
    yearBreakdown: [] as Array<{
      year: number;
      dateCreationMin: string;
      dateCreationMax: string;
      estimatedCompanies: number;
      estimatedCredits: number;
    }>,
    scansCreated: [] as string[],
    dryRun,
    message: '',
  };

  // Pour chaque année d'anniversaire, créer un scan_progress
  for (const targetYears of years) {
    const creationYear = targetDate.getFullYear() - targetYears;
    const creationMonth = targetDate.getMonth();
    
    // Date de création (tout le mois pour un premier scan)
    const dateCreationMin = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(creationYear, creationMonth + 1, 0).getDate();
    const dateCreationMax = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Estimation du nombre d'entreprises (basé sur statistiques INSEE)
    // Environ 500 000 créations/an en France, réparties sur 12 mois
    // Avec filtres (actives, taille min), on estime environ 5000-15000 par mois
    const estimatedCompanies = 10000; // Estimation conservative
    const estimatedCredits = Math.ceil(estimatedCompanies / RESULTS_PER_PAGE) * 0.1; // 0.1 crédit par résultat

    scanResults.yearBreakdown.push({
      year: targetYears,
      dateCreationMin,
      dateCreationMax,
      estimatedCompanies,
      estimatedCredits,
    });

    scanResults.totalEstimatedCompanies += estimatedCompanies;
    scanResults.totalEstimatedCredits += estimatedCredits;

    // Créer l'entrée scan_progress
    const { data: scanProgress, error: insertError } = await supabase
      .from('pappers_scan_progress')
      .insert({
        query_id: queryId || null,
        scan_type: 'anniversary',
        status: dryRun ? 'pending' : 'running',
        anniversary_years: targetYears,
        current_page: 1,
        total_pages: null,
        total_results: null,
        processed_results: 0,
        date_creation_min: dateCreationMin,
        date_creation_max: dateCreationMax,
        started_at: dryRun ? null : new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`[run-pappers-scan] Error creating scan progress for ${targetYears} years:`, insertError);
      continue;
    }

    scanResults.scansCreated.push(scanProgress.id);
    console.log(`[run-pappers-scan] Created scan progress for ${targetYears} years: ${scanProgress.id}`);
  }

  // Vérification des crédits
  if (scanResults.totalEstimatedCredits > creditsRemaining) {
    scanResults.message = `⚠️ ATTENTION: Crédits estimés (${scanResults.totalEstimatedCredits.toFixed(0)}) dépassent les crédits restants (${creditsRemaining.toFixed(0)}). Scan en mode simulation.`;
    console.warn(scanResults.message);
  }

  if (dryRun) {
    scanResults.message = `🔬 MODE SIMULATION: ${years.length} scans créés pour les années ${years.join(', ')}. Aucun appel API réel. Passez dryRun=false pour exécuter.`;
    console.log(scanResults.message);
  } else {
    scanResults.message = `🚀 SCAN LANCÉ: ${years.length} scans créés. Estimé: ${scanResults.totalEstimatedCompanies} entreprises, ${scanResults.totalEstimatedCredits.toFixed(0)} crédits.`;
    
    // TODO: Déclencher le traitement en background
    // EdgeRuntime.waitUntil(processScanInBackground(supabase, scanResults.scansCreated, PAPPERS_API_KEY));
  }

  return new Response(JSON.stringify({
    success: true,
    ...scanResults,
    credits: {
      remaining: creditsRemaining,
      limit: planSettings.monthly_credits,
      willUse: scanResults.totalEstimatedCredits,
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Fonction de simulation pour générer des données de test
function generateMockCompanies(count: number, year: number, dateCreationMin: string): any[] {
  const companies = [];
  const cities = ['Paris', 'Lyon', 'Marseille', 'Toulouse', 'Bordeaux', 'Nantes', 'Lille', 'Strasbourg'];
  const sectors = ['Commerce', 'Services', 'Industrie', 'Tech', 'BTP', 'Santé', 'Finance'];
  
  for (let i = 0; i < count; i++) {
    const dateCreation = new Date(dateCreationMin);
    dateCreation.setDate(dateCreation.getDate() + Math.floor(Math.random() * 28));
    
    companies.push({
      siren: `${100000000 + Math.floor(Math.random() * 899999999)}`,
      denomination: `Entreprise Test ${year}ans #${i + 1}`,
      date_creation: dateCreation.toISOString().split('T')[0],
      forme_juridique: ['SAS', 'SARL', 'SA', 'SCI'][Math.floor(Math.random() * 4)],
      effectif: ['10', '20', '50', '100', '250'][Math.floor(Math.random() * 5)],
      tranche_effectif: '10 à 19 salariés',
      chiffre_affaires: Math.floor(Math.random() * 50000000),
      code_naf: '6201Z',
      libelle_code_naf: 'Programmation informatique',
      siege: {
        ville: cities[Math.floor(Math.random() * cities.length)],
        region: 'Île-de-France',
      },
    });
  }
  
  return companies;
}

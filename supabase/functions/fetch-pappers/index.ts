import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PappersQuery {
  id: string;
  name: string;
  type: string;
  parameters: {
    region?: string;
    years?: number[];
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
  }

  return 0;
}

async function searchAnniversaries(query: PappersQuery, apiKey: string, supabase: any): Promise<number> {
  const { parameters, id: queryId } = query;
  const years = parameters.years || [10, 25, 50];
  
  let signalsCreated = 0;
  const currentYear = new Date().getFullYear();

  for (const targetYears of years) {
    const targetCreationYear = currentYear - targetYears;
    
    // Build Pappers API URL for recherche entreprise
    const params = new URLSearchParams({
      api_token: apiKey,
      date_creation_min: `${targetCreationYear}-01-01`,
      date_creation_max: `${targetCreationYear}-12-31`,
      per_page: '50',
      statut: 'actif',
    });

    // Add region filter (Île-de-France = 11)
    if (parameters.region && parameters.region !== 'all') {
      params.append('region', parameters.region);
    }

    // Add employee filter
    if (parameters.min_employees) {
      params.append('tranche_effectif_min', parameters.min_employees);
    }

    console.log(`[fetch-pappers] Searching ${targetYears}-year anniversaries (created in ${targetCreationYear})`);

    try {
      const response = await fetch(
        `https://api.pappers.fr/v2/recherche?${params.toString()}`,
        { headers: { 'Accept': 'application/json' } }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[fetch-pappers] Pappers API error: ${response.status} - ${errorText}`);
        continue;
      }

      const data = await response.json();
      const companies: PappersCompany[] = data.resultats || [];

      console.log(`[fetch-pappers] Found ${companies.length} companies for ${targetYears}-year anniversary`);

      for (const company of companies) {
        // Check if signal already exists
        const { data: existing } = await supabase
          .from('pappers_signals')
          .select('id')
          .eq('siren', company.siren)
          .eq('signal_type', 'anniversary')
          .single();

        if (existing) {
          continue; // Skip duplicate
        }

        // Calculate relevance score
        const score = calculateRelevanceScore(company, parameters);

        // Insert new signal
        const { error: insertError } = await supabase
          .from('pappers_signals')
          .insert({
            query_id: queryId,
            company_name: company.denomination,
            siren: company.siren,
            signal_type: 'anniversary',
            signal_detail: `Fête ses ${targetYears} ans en ${currentYear} (créée en ${targetCreationYear})`,
            relevance_score: score,
            company_data: {
              date_creation: company.date_creation,
              forme_juridique: company.forme_juridique,
              effectif: company.effectif || company.tranche_effectif,
              chiffre_affaires: company.chiffre_affaires,
              code_naf: company.code_naf,
              libelle_code_naf: company.libelle_code_naf,
              ville: company.siege?.ville,
              region: company.siege?.region,
            },
          });

        if (insertError) {
          console.error(`[fetch-pappers] Error inserting signal:`, insertError);
        } else {
          signalsCreated++;
        }
      }

    } catch (error) {
      console.error(`[fetch-pappers] Error fetching anniversaries:`, error);
    }
  }

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
    const response = await fetch(
      `https://api.pappers.fr/v2/publications?${params.toString()}`,
      { headers: { 'Accept': 'application/json' } }
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
        .single();

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
    const response = await fetch(
      `https://api.pappers.fr/v2/publications?${params.toString()}`,
      { headers: { 'Accept': 'application/json' } }
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
        .single();

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

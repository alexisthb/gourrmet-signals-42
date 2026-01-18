import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');

// Plancher absolu : 1 million d'euros
const REVENUE_FLOOR = 1_000_000;

/**
 * Estime le CA basé sur l'effectif (en euros)
 * < 50 employés: 100k€/employé
 * 50-250 employés: 120k€/employé
 * > 250 employés: 150k€/employé
 */
function estimateRevenueFromEmployees(employeeCount: number): number {
  if (!employeeCount || employeeCount <= 0) return 0;
  
  if (employeeCount < 50) {
    return employeeCount * 100_000;
  } else if (employeeCount <= 250) {
    return employeeCount * 120_000;
  } else {
    return employeeCount * 150_000;
  }
}

/**
 * Parse un effectif depuis différents formats
 * Ex: "20", "50-99", "20 à 49", "ETI", etc.
 */
function parseEmployeeCount(effectif: string | number | null | undefined): number {
  if (!effectif) return 0;
  
  if (typeof effectif === 'number') return effectif;
  
  const str = String(effectif).toLowerCase();
  
  // Essayer d'extraire un nombre ou une plage
  const rangeMatch = str.match(/(\d+)\s*(?:à|-)?\s*(\d+)?/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : min;
    return Math.round((min + max) / 2);
  }
  
  // Fallback par catégorie
  if (str.includes('eti')) return 300;
  if (str.includes('grand compte') || str.includes('ge')) return 1000;
  if (str.includes('pme')) return 50;
  if (str.includes('tpe')) return 5;
  
  return 0;
}

/**
 * Appelle Perplexity pour trouver le CA d'une entreprise
 */
async function fetchRevenueFromPerplexity(
  companyName: string
): Promise<{ revenue: number | null; source: 'perplexity' | 'not_found' }> {
  if (!PERPLEXITY_API_KEY) {
    console.log('[enrich-revenue] Perplexity API key not configured');
    return { revenue: null, source: 'not_found' };
  }

  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: 'Tu es un assistant qui recherche des informations financières sur les entreprises françaises. Réponds UNIQUEMENT en JSON valide, sans markdown.' 
          },
          { 
            role: 'user', 
            content: `Recherche le chiffre d'affaires annuel le plus récent de l'entreprise "${companyName}" en France.

Réponds UNIQUEMENT avec ce JSON (sans markdown ni texte):
{
  "company": "nom exact trouvé",
  "revenue_euros": nombre en euros (sans symbole, ex: 50000000 pour 50M€),
  "year": année du CA,
  "confidence": "high" | "medium" | "low",
  "source": "source de l'info"
}

Si tu ne trouves pas le CA, réponds:
{"company": "${companyName}", "revenue_euros": null, "confidence": "none", "source": null}`
          }
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('[enrich-revenue] Perplexity API error:', response.status);
      return { revenue: null, source: 'not_found' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log(`[enrich-revenue] Perplexity response for ${companyName}:`, content.substring(0, 200));

    // Parser le JSON
    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleanedContent);
    
    if (result.revenue_euros && typeof result.revenue_euros === 'number') {
      return { revenue: result.revenue_euros, source: 'perplexity' };
    }
    
    return { revenue: null, source: 'not_found' };

  } catch (error) {
    console.error('[enrich-revenue] Error calling Perplexity:', error);
    return { revenue: null, source: 'not_found' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    
    const { 
      company_name, 
      employee_count,
      effectif,
      skip_perplexity = false,
    } = body;

    if (!company_name) {
      return new Response(JSON.stringify({ error: 'company_name requis' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[enrich-revenue] Enriching revenue for: ${company_name}`);

    // 1. Essayer Perplexity d'abord (sauf si skip)
    let revenue: number | null = null;
    let revenueSource: 'perplexity' | 'estimated' | 'not_found' = 'not_found';

    if (!skip_perplexity) {
      const perplexityResult = await fetchRevenueFromPerplexity(company_name);
      
      // Enregistrer l'usage Perplexity
      await supabase.from('perplexity_usage').insert({
        query_type: 'company_revenue',
        company_name,
        success: perplexityResult.revenue !== null,
        revenue_found: perplexityResult.revenue,
        revenue_source: perplexityResult.source,
        tokens_used: 150, // Estimation
      });

      if (perplexityResult.revenue) {
        revenue = perplexityResult.revenue;
        revenueSource = 'perplexity';
        console.log(`[enrich-revenue] Found via Perplexity: ${revenue}€`);
      }
    }

    // 2. Si pas trouvé, estimer via effectif
    if (!revenue) {
      const employees = employee_count || parseEmployeeCount(effectif);
      
      if (employees > 0) {
        revenue = estimateRevenueFromEmployees(employees);
        revenueSource = 'estimated';
        console.log(`[enrich-revenue] Estimated from ${employees} employees: ${revenue}€`);
      }
    }

    // 3. Vérifier le plancher
    const meetsFloor = revenue !== null && revenue >= REVENUE_FLOOR;

    return new Response(JSON.stringify({
      success: true,
      company_name,
      revenue,
      revenue_source: revenueSource,
      revenue_formatted: revenue ? `${(revenue / 1_000_000).toFixed(1)}M€` : null,
      meets_floor: meetsFloor,
      floor: REVENUE_FLOOR,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[enrich-revenue] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

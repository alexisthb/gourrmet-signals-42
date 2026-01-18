import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
const REVENUE_FLOOR = 1_000_000; // 1M€ plancher absolu

/**
 * Estime le CA basé sur l'effectif (en euros)
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
 * Appelle Perplexity pour trouver le CA d'une entreprise
 */
async function fetchRevenueFromPerplexity(
  companyName: string
): Promise<{ revenue: number | null; source: 'perplexity' | 'not_found' }> {
  if (!PERPLEXITY_API_KEY) {
    console.log('[analyze-articles] Perplexity API key not configured');
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
      console.error('[analyze-articles] Perplexity API error:', response.status);
      return { revenue: null, source: 'not_found' };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    console.log(`[analyze-articles] Perplexity response for ${companyName}:`, content.substring(0, 200));

    // Parser le JSON
    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleanedContent);
    
    if (result.revenue_euros && typeof result.revenue_euros === 'number') {
      return { revenue: result.revenue_euros, source: 'perplexity' };
    }
    
    return { revenue: null, source: 'not_found' };

  } catch (error) {
    console.error('[analyze-articles] Error calling Perplexity:', error);
    return { revenue: null, source: 'not_found' };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    console.log('Starting analyze-articles function')

    // Get Claude API key from settings
    const { data: apiKeySetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'claude_api_key')
      .single()

    const claudeApiKey = apiKeySetting?.value
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured. Please add your API key in Settings.')
    }

    // Get auto-enrich settings (read once at start)
    const { data: autoEnrichSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'auto_enrich_enabled')
      .maybeSingle()
    
    const { data: autoEnrichMinScoreSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'auto_enrich_min_score')
      .maybeSingle()
    
    const autoEnrichEnabled = autoEnrichSetting?.value !== 'false'
    const autoEnrichMinScore = parseInt(autoEnrichMinScoreSetting?.value || '4', 10)
    console.log(`Auto-enrich enabled: ${autoEnrichEnabled}, min score: ${autoEnrichMinScore}`)

    // Get min employees filter from settings
    const { data: minEmployeesSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'min_employees_presse')
      .maybeSingle()
    
    const minEmployees = parseInt(minEmployeesSetting?.value || '20', 10)
    console.log(`Min employees filter for Presse: ${minEmployees}`)

    // Get min revenue filter from settings (pour Presse)
    const { data: minRevenueSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'min_revenue_presse')
      .maybeSingle()
    
    const minRevenue = parseInt(minRevenueSetting?.value || String(REVENUE_FLOOR), 10)
    console.log(`Min revenue filter for Presse: ${minRevenue}€`)

    // Get Perplexity enrichment setting
    const { data: perplexityEnrichSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'perplexity_enrich_presse')
      .maybeSingle()
    
    const perplexityEnrichEnabled = perplexityEnrichSetting?.value !== 'false'
    console.log(`Perplexity revenue enrichment enabled: ${perplexityEnrichEnabled}`)
    // Get unprocessed articles (max 30 per batch)
    const { data: articles, error: articlesError } = await supabase
      .from('raw_articles')
      .select('*')
      .eq('processed', false)
      .order('published_at', { ascending: false })
      .limit(30)

    if (articlesError) {
      console.error('Error fetching articles:', articlesError)
      throw articlesError
    }
    
    if (!articles || articles.length === 0) {
      console.log('No articles to process')
      return new Response(
        JSON.stringify({ success: true, message: 'No articles to process', signals_created: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing ${articles.length} articles`)

    // Prepare articles text for Claude
    const articlesText = articles.map((a, i) => 
      `[ARTICLE ${i + 1}]
Titre: ${a.title}
Source: ${a.source_name || 'Inconnue'}
Date: ${a.published_at || 'Inconnue'}
Description: ${a.description || 'N/A'}
Contenu: ${a.content || 'N/A'}
URL: ${a.url}
`
    ).join('\n---\n\n')

const prompt = `Tu es un assistant commercial expert pour Gourrmet, spécialiste français du cadeau d'affaires haut de gamme (chocolats Chapon, truffes Plantin, parfums Durance, cocktails ELY, coffrets Publicis Drugstore).

Ta mission : analyser des articles de presse économique française et identifier les "signaux Gourrmet" — des événements qui justifieraient qu'une entreprise fasse appel à Gourrmet pour offrir des cadeaux premium à ses équipes, clients ou partenaires.

## ⚠️ FILTRE GÉOGRAPHIQUE OBLIGATOIRE

**IGNORER ABSOLUMENT** toute entreprise qui n'est PAS :
- Basée en FRANCE
- Située dans l'une des régions prioritaires : **Île-de-France, Provence-Alpes-Côte d'Azur (PACA), Auvergne-Rhône-Alpes**

Si l'article mentionne une entreprise étrangère (USA, UK, Allemagne, Canada, etc.) ou une entreprise française hors de ces 3 régions : **NE PAS créer de signal**.

Exemples à IGNORER :
- Apple (siège Cupertino, USA) → IGNORER
- Microsoft France (si pas IDF/PACA/ARA) → IGNORER  
- Une startup de Bordeaux → IGNORER
- Un cabinet de Lille → IGNORER

Exemples à RETENIR :
- Cabinet d'avocats à Paris → ✓
- Entreprise à Lyon → ✓
- Société à Marseille → ✓
- Startup à Nice → ✓

## ⚠️ FILTRE EFFECTIFS OBLIGATOIRE

**MINIMUM ${minEmployees} SALARIÉS** : Ignorer toutes les entreprises ayant moins de ${minEmployees} salariés (sauf levée de fonds très importante >10M€).

## TYPES DE SIGNAUX À DÉTECTER

1. **anniversaire** : L'entreprise fête X ans d'existence, de présence en France, centenaire, jubilé, etc. C'est le signal le plus fort car l'entreprise VEUT célébrer.

2. **levee** : Levée de fonds significative (>5M€), tour de table, série A/B/C. Signal fort : l'entreprise a de l'argent et veut remercier/motiver.

3. **ma** : Acquisition, fusion, rapprochement, rachat, création d'un nouveau groupe. Signal fort : nouveau départ, intégration d'équipes.

4. **distinction** : Prix, classement, label, certification, palmarès ("meilleur employeur", "Best Lawyers", "Great Place to Work", "Legal 500", etc.). Signal très fort : l'entreprise veut célébrer sa reconnaissance.

5. **expansion** : Nouveau bureau, nouveau siège, nouvelle implantation, inauguration. Signal fort : événement à marquer.

6. **nomination** : Nouveau dirigeant (CEO, DG, Président). Signal plus faible mais peut être pertinent pour des cadeaux ciblés.

## CRITÈRES DE SCORING (1-5)

**Score 5** : Signal très fort (anniversaire rond, distinction majeure, grosse levée >20M€) + cible premium (avocat, conseil, finance, luxe, immobilier prestige) + grande entreprise (>200 employés estimés)

**Score 4** : Signal fort + bonne cible OU signal moyen + cible très premium

**Score 3** : Signal valide avec opportunité commerciale réelle, cible correcte

**Score 2** : Signal faible ou cible peu adaptée au haut de gamme (à ignorer)

**Score 1** : Non pertinent (à ignorer)

## FILTRE ICP (Ideal Customer Profile de Gourrmet)

**IGNORER absolument** :
- Entreprises de moins de ${minEmployees} salariés (sauf levée exceptionnelle >10M€)
- Associations, ONG, fondations
- Collectivités, administrations publiques
- Startups early stage (pré-seed, seed <3M€)
- Secteurs incompatibles : agriculture, BTP bas de gamme, discount, fast-food

**PRIORISER fortement** :
- Cabinets d'avocats d'affaires
- Cabinets de conseil (stratégie, management)
- Big Four et cabinets d'audit
- Banques privées, banques d'affaires
- Sociétés de gestion, Private Equity, Asset Management
- Luxe & cosmétiques (maisons, groupes)
- Immobilier haut de gamme (promotion, gestion)
- Pharma & santé (labos, biotech matures)
- Tech mature (scale-ups >50M€ levés, licornes, éditeurs)
- Assurances, mutuelles premium
- Hôtellerie & restauration haut de gamme

## FORMAT DE RÉPONSE

Réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après, sans markdown :

{
  "signals": [
    {
      "company_name": "Nom exact de l'entreprise tel que mentionné",
      "signal_type": "anniversaire|levee|ma|distinction|expansion|nomination",
      "event_detail": "Description factuelle et concise de l'événement (max 150 caractères)",
      "sector": "Secteur d'activité précis",
      "estimated_size": "PME|ETI|Grand Compte|Inconnu",
      "score": 5,
      "hook_suggestion": "Suggestion d'accroche personnalisée pour le message de prospection, mentionnant l'événement spécifique",
      "source_url": "URL exacte de l'article"
    }
  ],
  "articles_analyzed": 12,
  "signals_found": 3
}

**RÈGLES IMPORTANTES** :
- Ne retourne QUE les signaux avec score >= 3
- Un article peut contenir plusieurs signaux (plusieurs entreprises mentionnées)
- Si aucun signal pertinent : {"signals": [], "articles_analyzed": X, "signals_found": 0}
- Le hook_suggestion doit être en français, professionnel, personnalisé à l'événement
- Vérifie que source_url correspond bien à l'article analysé

---

ARTICLES À ANALYSER :

${articlesText}`

    console.log('Calling Claude API...')

    // Call Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    })

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text()
      console.error('Claude API error:', claudeResponse.status, errorText)
      throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`)
    }

    const claudeData = await claudeResponse.json()
    const responseText = claudeData.content[0].text

    console.log('Claude response received, parsing...')

    // Parse JSON response
    let analysisResult
    try {
      const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      analysisResult = JSON.parse(cleanedText)
    } catch (parseError) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0])
      } else {
        console.error('Failed to parse Claude response:', responseText.substring(0, 500))
        throw new Error('Failed to parse Claude response as JSON')
      }
    }

    console.log(`Analysis found ${analysisResult.signals?.length || 0} signals`)

    // Insert detected signals
    let signalsCreated = 0
    let signalsFilteredByRevenue = 0
    let autoEnrichedCount = 0
    
    for (const signal of analysisResult.signals || []) {
      // Check for duplicates
      const { data: existingSignal } = await supabase
        .from('signals')
        .select('id')
        .eq('company_name', signal.company_name)
        .eq('source_url', signal.source_url)
        .maybeSingle()

      if (!existingSignal) {
        // === ENRICHISSEMENT CA VIA PERPLEXITY ===
        let revenue: number | null = null;
        let revenueSource: 'perplexity' | 'estimated' | null = null;
        let meetsRevenueThreshold = true;

        if (perplexityEnrichEnabled && PERPLEXITY_API_KEY) {
          console.log(`[analyze-articles] Fetching revenue for ${signal.company_name} via Perplexity...`);
          
          const perplexityResult = await fetchRevenueFromPerplexity(signal.company_name);
          
          // Enregistrer l'usage Perplexity
          await supabase.from('perplexity_usage').insert({
            query_type: 'presse_revenue',
            company_name: signal.company_name,
            success: perplexityResult.revenue !== null,
            revenue_found: perplexityResult.revenue,
            revenue_source: perplexityResult.source,
            tokens_used: 150,
          });

          if (perplexityResult.revenue) {
            revenue = perplexityResult.revenue;
            revenueSource = 'perplexity';
            console.log(`[analyze-articles] Found revenue via Perplexity: ${revenue}€ for ${signal.company_name}`);
            
            // Vérifier si le CA est au-dessus du seuil minimum
            if (revenue < minRevenue) {
              console.log(`[analyze-articles] ❌ Revenue ${revenue}€ below threshold ${minRevenue}€ for ${signal.company_name} - SKIPPING`);
              meetsRevenueThreshold = false;
              signalsFilteredByRevenue++;
            }
          } else {
            // Si Perplexity ne trouve pas, estimer via estimated_size
            const sizeEstimates: Record<string, number> = {
              'PME': 50,
              'ETI': 300,
              'Grand Compte': 1000,
              'Inconnu': 100,
            };
            const estimatedEmployees = sizeEstimates[signal.estimated_size] || 100;
            revenue = estimateRevenueFromEmployees(estimatedEmployees);
            revenueSource = 'estimated';
            console.log(`[analyze-articles] Estimated revenue from ${signal.estimated_size} (${estimatedEmployees} emp): ${revenue}€`);
            
            // Vérifier le seuil pour les estimations aussi
            if (revenue < minRevenue) {
              console.log(`[analyze-articles] ⚠️ Estimated revenue ${revenue}€ below threshold ${minRevenue}€ for ${signal.company_name} - SKIPPING`);
              meetsRevenueThreshold = false;
              signalsFilteredByRevenue++;
            }
          }
        }

        // Ne pas créer le signal si le CA est sous le seuil
        if (!meetsRevenueThreshold) {
          continue;
        }

        const { data: insertedSignal, error: insertError } = await supabase
          .from('signals')
          .insert({
            company_name: signal.company_name,
            signal_type: signal.signal_type,
            event_detail: signal.event_detail,
            sector: signal.sector,
            estimated_size: signal.estimated_size || 'Inconnu',
            score: signal.score,
            hook_suggestion: signal.hook_suggestion,
            source_url: signal.source_url,
            source_name: articles.find(a => a.url === signal.source_url)?.source_name || null,
            revenue: revenue,
            revenue_source: revenueSource,
          })
          .select('id')
          .single()

        if (!insertError && insertedSignal) {
          signalsCreated++
          
          // Auto-trigger Manus enrichment for high-score signals
          if (autoEnrichEnabled && signal.score >= autoEnrichMinScore) {
            console.log(`Triggering auto-enrichment for signal ${insertedSignal.id} (score: ${signal.score}, min: ${autoEnrichMinScore}, company: ${signal.company_name})`)
            
            try {
              const enrichResponse = await fetch(
                `${supabaseUrl}/functions/v1/trigger-manus-enrichment`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseKey}`
                  },
                  body: JSON.stringify({ signal_id: insertedSignal.id })
                }
              )
              
              if (enrichResponse.ok) {
                console.log(`Auto-enrichment triggered successfully for ${signal.company_name}`)
                autoEnrichedCount++
              } else {
                const errorText = await enrichResponse.text()
                console.error(`Auto-enrichment failed for ${signal.company_name}:`, errorText)
              }
            } catch (enrichError) {
              console.error(`Error triggering auto-enrichment for ${signal.company_name}:`, enrichError)
            }
          }
        } else if (insertError) {
          console.error('Error inserting signal:', insertError)
        }
      }
    }

    // Mark articles as processed
    const articleIds = articles.map(a => a.id)
    await supabase
      .from('raw_articles')
      .update({ processed: true })
      .in('id', articleIds)

    console.log(`Analysis complete: ${signalsCreated} signals created, ${signalsFilteredByRevenue} filtered by revenue, ${autoEnrichedCount} auto-enriched`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        articles_processed: articles.length,
        signals_created: signalsCreated,
        signals_filtered_by_revenue: signalsFilteredByRevenue,
        auto_enriched: autoEnrichedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in analyze-articles:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
- Entreprises <50 salariés (sauf levée >10M€)
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
    for (const signal of analysisResult.signals || []) {
      // Check for duplicates
      const { data: existingSignal } = await supabase
        .from('signals')
        .select('id')
        .eq('company_name', signal.company_name)
        .eq('source_url', signal.source_url)
        .maybeSingle()

      if (!existingSignal) {
        const { error: insertError } = await supabase
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
          })

        if (!insertError) {
          signalsCreated++
        } else {
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

    console.log(`Analysis complete: ${signalsCreated} signals created`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        articles_processed: articles.length,
        signals_created: signalsCreated
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MANUS_API_KEY = Deno.env.get('MANUS_API_KEY');
const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { sourceIds, maxPosts = 4 } = await req.json();

    console.log(`[scan-linkedin-manus] Starting scan with Manus orchestration`);
    console.log(`[scan-linkedin-manus] sourceIds: ${sourceIds?.join(', ') || 'all active'}, maxPosts: ${maxPosts}`);

    if (!MANUS_API_KEY) {
      throw new Error('MANUS_API_KEY is not configured');
    }

    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY is not configured');
    }

    // 1. Récupérer les sources à scanner
    let sourcesQuery = supabase
      .from('linkedin_sources')
      .select('*')
      .eq('is_active', true);

    if (sourceIds && sourceIds.length > 0) {
      sourcesQuery = sourcesQuery.in('id', sourceIds);
    }

    const { data: sources, error: sourcesError } = await sourcesQuery;

    if (sourcesError) throw sourcesError;

    if (!sources || sources.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Aucune source active à scanner',
        manus_task_id: null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[scan-linkedin-manus] Found ${sources.length} sources to scan`);

    // 2. Construire le prompt pour Manus
    const sourcesList = sources.map((s, i) => 
      `${i + 1}. ${s.name} (${s.source_type}): ${s.linkedin_url}`
    ).join('\n');

    const manusPrompt = `
# Mission: LinkedIn Engagement Scan & Contact Enrichment

Tu es un agent spécialisé dans l'identification et l'enrichissement de contacts LinkedIn. 
Tu as accès aux outils Apify pour scraper LinkedIn.

## Étape 1: Scraper les posts récents

Pour chaque source LinkedIn ci-dessous, utilise les scrapers Apify appropriés pour récupérer les ${maxPosts} derniers posts:

${sourcesList}

**Scrapers Apify à utiliser:**
- Pour les profils: \`harvestapi~linkedin-profile-posts\` avec input: { "targetUrls": ["<url_profil>"], "maxPosts": ${maxPosts} }
- Pour les company pages: \`harvestapi~linkedin-company-posts\` avec input: { "targetUrls": ["<url_company>"], "maxPosts": ${maxPosts} }

## Étape 2: Scraper les engagers de chaque post

Pour chaque post trouvé, utilise \`harvestapi~linkedin-post-reactions\` pour récupérer les personnes qui ont interagi (likes, comments).

Input: { "posts": ["<url_post>"], "maxItems": 100 }

## Étape 3: Enrichir les profils des engagers

Pour chaque engager identifié qui semble être un prospect intéressant (exclure les profils sans headline ou qui semblent être des bots):

1. **Scrape le profil LinkedIn détaillé** avec \`curious_cid~linkedin-profile-scraper\`:
   - Input: { "urls": ["<linkedin_url>"] }
   - Récupère: nom complet, headline, entreprise actuelle, localisation, expériences

2. **Trouve l'email professionnel** avec \`curious_cid~rocketreach-person-lookup\` (si disponible) ou déduis-le du domaine de l'entreprise:
   - Formats courants: prenom.nom@entreprise.com, pnom@entreprise.com, prenom@entreprise.com

## Étape 4: Structure de sortie

Retourne un JSON structuré avec:

\`\`\`json
{
  "scan_summary": {
    "sources_scanned": <number>,
    "posts_found": <number>,
    "engagers_found": <number>,
    "contacts_enriched": <number>
  },
  "posts": [
    {
      "source_name": "<nom_source>",
      "source_url": "<url_source>",
      "post_url": "<url_post>",
      "post_content": "<extrait_contenu>",
      "published_at": "<date>",
      "likes_count": <number>,
      "comments_count": <number>,
      "engagers": [
        {
          "name": "<nom_complet>",
          "linkedin_url": "<url_profil>",
          "headline": "<headline>",
          "company": "<entreprise>",
          "engagement_type": "like|comment",
          "enriched_data": {
            "email": "<email_si_trouvé>",
            "phone": "<phone_si_trouvé>",
            "location": "<localisation>",
            "current_position": "<poste_actuel>",
            "profile_summary": "<résumé>"
          }
        }
      ]
    }
  ]
}
\`\`\`

## Clé API Apify

Utilise cette clé pour les appels Apify: ${APIFY_API_KEY}

## Instructions importantes

1. Ne skip pas d'étapes - exécute chaque scraper dans l'ordre
2. Gère les erreurs gracieusement - si un scraper échoue, continue avec les autres
3. Log ta progression pour que je puisse suivre
4. Priorise les engagers qui ont commenté (plus engagés que ceux qui ont juste liké)
5. Limite l'enrichissement aux 50 engagers les plus pertinents par source pour gérer les coûts

Commence maintenant le scan !
`;

    console.log(`[scan-linkedin-manus] Calling Manus API...`);

    // 3. Appeler l'API Manus
    const manusResponse = await fetch('https://api.manus.ai/v1/tasks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MANUS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: manusPrompt,
        model: 'manus-1',
      }),
    });

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error(`[scan-linkedin-manus] Manus API error: ${errorText}`);
      throw new Error(`Manus API error: ${manusResponse.status} - ${errorText}`);
    }

    const manusData = await manusResponse.json();
    const manusTaskId = manusData.task_id || manusData.id;
    const manusTaskUrl = manusData.url || `https://manus.ai/tasks/${manusTaskId}`;

    console.log(`[scan-linkedin-manus] Manus task created: ${manusTaskId}`);
    console.log(`[scan-linkedin-manus] Task URL: ${manusTaskUrl}`);

    // 4. Mettre à jour les sources avec l'ID de tâche Manus
    for (const source of sources) {
      await supabase
        .from('linkedin_sources')
        .update({
          last_scraped_at: new Date().toISOString(),
        })
        .eq('id', source.id);
    }

    // 5. Créer un enregistrement de suivi du scan
    const { data: scanRecord, error: scanError } = await supabase
      .from('linkedin_scan_progress')
      .insert({
        manus_task_id: manusTaskId,
        manus_task_url: manusTaskUrl,
        status: 'manus_processing',
        sources_count: sources.length,
        max_posts: maxPosts,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (scanError) {
      console.error(`[scan-linkedin-manus] Error creating scan record:`, scanError);
      // Continue anyway, the Manus task is started
    }

    return new Response(JSON.stringify({
      success: true,
      manus_task_id: manusTaskId,
      manus_task_url: manusTaskUrl,
      scan_id: scanRecord?.id,
      sources_count: sources.length,
      message: `Scan Manus lancé pour ${sources.length} sources. Manus va scraper les posts, identifier les engagers et enrichir leurs profils.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scan-linkedin-manus] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

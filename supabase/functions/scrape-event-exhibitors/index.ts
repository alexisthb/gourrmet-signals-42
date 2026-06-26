import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Catégories cibles avec scores de qualification
const TARGET_CATEGORIES: Record<string, number> = {
  'wedding planner': 5,
  'organisateur de mariage': 5,
  'organisateur': 5,
  'agence': 4,
  'marketplace': 4,
  'cadeau': 4,
  'liste de mariage': 4,
  'traiteur': 3,
  'photographe': 3,
  'vidéaste': 3,
  'dj': 2,
  'animation': 2,
  'décoration': 2,
  'fleuriste': 2,
  'bijoux': 2,
  'alliances': 2,
  'robe': 1,
  'costume': 1,
  'lieu': 1,
};

interface ApifyRunResult {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface ScrapedExhibitor {
  name: string;
  category?: string;
  description?: string;
  website?: string;
  images?: string[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!APIFY_API_KEY) {
      throw new Error('APIFY_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { action, sourceUrl, sessionId, eventId } = await req.json();
    
    console.log(`[scrape-exhibitors] Action: ${action}, URL: ${sourceUrl}`);

    // ========== ACTION: Lancer le scraping ==========
    if (action === 'start_scrape') {
      if (!sourceUrl) {
        throw new Error('sourceUrl is required');
      }

      // Créer une session de scraping
      const { data: session, error: sessionError } = await supabase
        .from('scrap_sessions')
        .insert({
          source_url: sourceUrl,
          event_id: eventId || null,
          status: 'running',
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      // Lancer le scraping Apify avec Web Scraper (Puppeteer) - SCROLL AGRESSIF + PROXY RÉSIDENTIEL
      // Cette configuration a été testée et validée sur lesalondumariage.com (270+ exposants récupérés)
      const pageFunction = `
        async function pageFunction(context) {
          const { page, request, log } = context;
          
          log.info('🚀 Starting AGGRESSIVE scroll with residential proxy...');
          
          // Configuration du scroll agressif pour infinite scroll
          let previousHeight = 0;
          let scrollAttempts = 0;
          const maxScrollAttempts = 100; // Plus de tentatives pour les gros salons
          let noChangeCount = 0;
          const maxNoChange = 5; // Arrêter après 5 scrolls sans nouveau contenu
          
          while (scrollAttempts < maxScrollAttempts) {
            // Scroll agressif : plusieurs techniques combinées
            await page.evaluate(() => {
              // Technique 1: Scroll vers le bas de la page
              window.scrollTo(0, document.body.scrollHeight);
              // Technique 2: Scroll d'un élément spécifique si présent
              const main = document.querySelector('main');
              if (main) main.scrollTop = main.scrollHeight;
            });
            
            // Attendre le chargement du nouveau contenu (plus long pour les sites lents)
            await new Promise(resolve => setTimeout(resolve, 2500));
            
            // Vérifier si on a chargé du nouveau contenu
            const currentHeight = await page.evaluate(() => document.body.scrollHeight);
            
            if (currentHeight === previousHeight) {
              noChangeCount++;
              log.info('No new content (attempt ' + noChangeCount + '/' + maxNoChange + ')');
              if (noChangeCount >= maxNoChange) {
                log.info('✅ Finished scrolling - no more content to load');
                break;
              }
            } else {
              noChangeCount = 0; // Reset si on a du nouveau contenu
            }
            
            previousHeight = currentHeight;
            scrollAttempts++;
            
            // Log tous les 10 scrolls
            if (scrollAttempts % 10 === 0) {
              const count = await page.evaluate(() => document.querySelectorAll('h2').length);
              log.info('Scroll #' + scrollAttempts + ' - Height: ' + currentHeight + ' - Exhibitors found: ' + count);
            }
          }
          
          log.info('📊 Extracting exhibitors from loaded content...');
          
          // Extraire tous les exposants après le chargement complet
          const results = await page.evaluate(() => {
            const exhibitors = [];
            const seenNames = new Set(); // Éviter les doublons
            
            // Trouver tous les blocs d'exposants (h2 = nom de l'exposant)
            const h2Elements = document.querySelectorAll('h2');
            
            h2Elements.forEach(h2 => {
              const name = h2.textContent?.trim();
              if (!name || name.length < 3 || name.length > 150) return;
              if (name.includes('Rencontrez') || name.includes('exposants') || name.includes('Filtrer')) return;
              if (seenNames.has(name)) return; // Skip doublons
              seenNames.add(name);
              
              // Remonter pour trouver le conteneur parent
              let container = h2.closest('article') || h2.closest('[class*="card"]') || h2.closest('div');
              if (!container) container = h2.parentElement;
              
              // Catégorie - généralement le premier paragraphe ou span après le h2
              let category = null;
              const nextSibling = h2.nextElementSibling;
              if (nextSibling) {
                const text = nextSibling.textContent?.trim();
                if (text && text.length < 100) {
                  category = text;
                }
              }
              // Chercher aussi dans les spans avec classe catégorie
              if (!category && container) {
                const catEl = container.querySelector('[class*="category"], [class*="type"], .text-muted');
                if (catEl) category = catEl.textContent?.trim();
              }
              
              // Description - texte plus long dans le conteneur
              let description = null;
              if (container) {
                const ps = container.querySelectorAll('p, [class*="description"]');
                ps.forEach(p => {
                  const text = p.textContent?.trim();
                  if (text && text.length > 30 && text.length < 500 && text !== category) {
                    description = text;
                  }
                });
              }
              
              // Site web - lien externe
              let website = null;
              if (container) {
                const links = container.querySelectorAll('a[href*="http"]');
                links.forEach(link => {
                  const href = link.getAttribute('href');
                  if (href && !href.includes('lesalondumariage') && !href.includes('supabase') && !href.includes('facebook') && !href.includes('instagram')) {
                    website = href;
                  }
                });
              }
              
              // Images du produit/exposant
              const images = [];
              if (container) {
                container.querySelectorAll('img[src]').forEach(img => {
                  const src = img.getAttribute('src');
                  if (src && !src.includes('placeholder') && !src.includes('avatar') && src.startsWith('http')) {
                    images.push(src);
                  }
                });
              }
              
              exhibitors.push({
                name,
                category: category || null,
                description: description || null,
                website: website || null,
                images: images.slice(0, 5),
              });
            });
            
            return exhibitors;
          });
          
          log.info('✅ Found ' + results.length + ' exhibitors total');
          return results;
        }
      `;

      // Démarrer l'actor Web Scraper avec PROXY RÉSIDENTIEL pour contourner l'anti-bot
      const runResponse = await fetch(
        `https://api.apify.com/v2/acts/apify~web-scraper/runs?token=${APIFY_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startUrls: [{ url: sourceUrl }],
            pageFunction,
            // 🔑 PROXY RÉSIDENTIEL = Clé du succès pour les sites avec anti-bot
            proxyConfiguration: { 
              useApifyProxy: true,
              apifyProxyGroups: ['RESIDENTIAL']
            },
            maxRequestsPerCrawl: 1, // Une seule page avec scroll infini
            maxConcurrency: 1,
            navigationTimeoutSecs: 180, // 3 minutes pour les gros salons
            pageLoadTimeoutSecs: 180,
            // Options supplémentaires pour la robustesse
            waitUntil: 'networkidle2', // Attendre que le réseau soit calme
            useChrome: true, // Chrome headless (plus compatible)
          }),
        }
      );

      if (!runResponse.ok) {
        const errorText = await runResponse.text();
        console.error(`[scrape-exhibitors] Apify run failed: ${errorText}`);
        
        await supabase
          .from('scrap_sessions')
          .update({ 
            status: 'failed', 
            error_message: errorText,
            completed_at: new Date().toISOString(),
          })
          .eq('id', session.id);
          
        throw new Error(`Apify run failed: ${errorText}`);
      }

      const runData: ApifyRunResult = await runResponse.json();
      
      // Mettre à jour la session avec l'ID du run Apify
      await supabase
        .from('scrap_sessions')
        .update({ apify_run_id: runData.data.id })
        .eq('id', session.id);

      return new Response(JSON.stringify({ 
        success: true, 
        sessionId: session.id,
        apifyRunId: runData.data.id,
        message: 'Scraping started'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== ACTION: Vérifier le statut et récupérer les résultats ==========
    if (action === 'check_status') {
      if (!sessionId) {
        throw new Error('sessionId is required');
      }

      // Récupérer la session
      const { data: session, error: sessionError } = await supabase
        .from('scrap_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError) throw sessionError;

      if (!session.apify_run_id) {
        return new Response(JSON.stringify({ 
          status: session.status,
          message: 'No Apify run associated'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Vérifier le statut du run Apify
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${session.apify_run_id}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusResponse.json();
      const apifyStatus = statusData.data.status;

      console.log(`[scrape-exhibitors] Apify status: ${apifyStatus}`);

      if (apifyStatus === 'SUCCEEDED') {
        // Récupérer les résultats
        const datasetId = statusData.data.defaultDatasetId;
        const dataResponse = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
        );
        const rawResults = await dataResponse.json();
        
        // Flatten les résultats (chaque page retourne un array)
        const results: ScrapedExhibitor[] = rawResults.flat();
        
        console.log(`[scrape-exhibitors] Got ${results.length} exhibitors`);

        // Insérer les exposants avec scoring
        let insertedCount = 0;
        for (const exhibitor of results) {
          const qualificationScore = calculateQualificationScore(exhibitor);
          const targetCategory = identifyTargetCategory(exhibitor);

          const { error: insertError } = await supabase
            .from('event_exhibitors')
            .insert({
              scrap_session_id: sessionId,
              event_id: session.event_id,
              name: exhibitor.name,
              category: exhibitor.category,
              description: exhibitor.description,
              website: exhibitor.website,
              source_url: session.source_url,
              images: exhibitor.images || [],
              qualification_score: qualificationScore,
              target_category: targetCategory,
            });

          if (!insertError) insertedCount++;
        }

        // Mettre à jour la session
        await supabase
          .from('scrap_sessions')
          .update({ 
            status: 'completed',
            exhibitors_found: insertedCount,
            completed_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        // Logger l'utilisation Apify
        await supabase
          .from('apify_credit_usage')
          .insert({
            date: new Date().toISOString().split('T')[0],
            credits_used: 0.25, // ~$0.25 par run Cheerio
            scrapes_count: 1,
            source: 'event_exhibitors',
            details: { sessionId, exhibitorsFound: insertedCount }
          });

        return new Response(JSON.stringify({ 
          status: 'completed',
          exhibitorsFound: insertedCount,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (apifyStatus === 'FAILED' || apifyStatus === 'ABORTED') {
        await supabase
          .from('scrap_sessions')
          .update({ 
            status: 'failed',
            error_message: `Apify run ${apifyStatus}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        return new Response(JSON.stringify({ 
          status: 'failed',
          error: `Apify run ${apifyStatus}`,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Toujours en cours
      return new Response(JSON.stringify({ 
        status: 'running',
        apifyStatus,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scrape-exhibitors] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Calculer le score de qualification basé sur la catégorie
function calculateQualificationScore(exhibitor: ScrapedExhibitor): number {
  if (!exhibitor.category) return 1;
  
  const categoryLower = exhibitor.category.toLowerCase();
  const descLower = (exhibitor.description || '').toLowerCase();
  const combined = `${categoryLower} ${descLower}`;
  
  let maxScore = 1;
  
  for (const [keyword, score] of Object.entries(TARGET_CATEGORIES)) {
    if (combined.includes(keyword)) {
      maxScore = Math.max(maxScore, score);
    }
  }
  
  return maxScore;
}

// Identifier la catégorie cible
function identifyTargetCategory(exhibitor: ScrapedExhibitor): string | null {
  if (!exhibitor.category) return null;
  
  const categoryLower = exhibitor.category.toLowerCase();
  const descLower = (exhibitor.description || '').toLowerCase();
  const combined = `${categoryLower} ${descLower}`;
  
  if (combined.includes('wedding planner') || combined.includes('organisateur')) {
    return 'Wedding Planner';
  }
  if (combined.includes('marketplace') || combined.includes('liste de mariage') || combined.includes('cadeau')) {
    return 'Marketplace Cadeaux';
  }
  if (combined.includes('agence')) {
    return 'Agence';
  }
  if (combined.includes('traiteur')) {
    return 'Traiteur';
  }
  if (combined.includes('photo') || combined.includes('vidéo')) {
    return 'Photo/Vidéo';
  }
  
  return null;
}


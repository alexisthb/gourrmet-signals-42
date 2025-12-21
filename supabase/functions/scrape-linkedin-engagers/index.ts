import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Apify actors - nouveaux acteurs selon les specs
const APIFY_ACTORS = {
  profilePosts: 'apimaestro/linkedin-profile-posts', // Posts d'un profil personnel
  companyPosts: 'apimaestro/linkedin-company-posts', // Posts d'une page entreprise
  postReactions: 'harvestapi/linkedin-post-reactions', // Réactions sur un post
};

interface ApifyRunResult {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface LinkedInPost {
  postUrl?: string;
  url?: string;
  text?: string;
  content?: string;
  publishedAt?: string;
  date?: string;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
}

interface LinkedInReaction {
  profileUrl?: string;
  linkedinUrl?: string;
  name?: string;
  fullName?: string;
  headline?: string;
  company?: string;
  reactionType?: string;
  comment?: string;
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
    const { action, postUrl, postId, sourceId } = await req.json();
    
    console.log(`[scrape-linkedin] Action: ${action}`);

    // ========== ACTION: Ajouter un post manuellement ==========
    if (action === 'add_post') {
      const { data: post, error } = await supabase
        .from('linkedin_posts')
        .upsert({
          post_url: postUrl,
          title: `Post LinkedIn`,
          source_id: sourceId || null,
        }, { onConflict: 'post_url' })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, post }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== ACTION: Scan complet (sources -> posts -> reactions) ==========
    if (action === 'full_scan') {
      console.log('[scrape-linkedin] Starting full scan...');
      
      // 1. Récupérer toutes les sources actives
      const { data: sources, error: sourcesError } = await supabase
        .from('linkedin_sources')
        .select('*')
        .eq('is_active', true);

      if (sourcesError) throw sourcesError;

      if (!sources || sources.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Aucune source active',
          newPosts: 0,
          engagersFound: 0 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let totalNewPosts = 0;
      let totalEngagers = 0;

      // 2. Pour chaque source, scraper les posts
      for (const source of sources) {
        console.log(`[scrape-linkedin] Scraping source: ${source.name} (${source.source_type})`);
        
        const actorId = source.source_type === 'profile' 
          ? APIFY_ACTORS.profilePosts 
          : APIFY_ACTORS.companyPosts;
        
        const posts = await scrapePostsFromSource(actorId, source.linkedin_url);
        console.log(`[scrape-linkedin] Found ${posts.length} posts from ${source.name}`);

        // 3. Pour chaque post, l'insérer et scraper les réactions
        for (const post of posts) {
          const postUrl = post.postUrl || post.url;
          if (!postUrl) continue;

          // Insérer/mettre à jour le post
          const { data: savedPost, error: postError } = await supabase
            .from('linkedin_posts')
            .upsert({
              post_url: postUrl,
              source_id: source.id,
              title: (post.text || post.content || '').substring(0, 100) || 'Post LinkedIn',
              content: post.text || post.content,
              published_at: post.publishedAt || post.date || null,
              likes_count: post.likesCount || 0,
              comments_count: post.commentsCount || 0,
              shares_count: post.sharesCount || 0,
            }, { onConflict: 'post_url' })
            .select()
            .single();

          if (postError) {
            console.error('[scrape-linkedin] Error saving post:', postError);
            continue;
          }

          totalNewPosts++;

          // 4. Scraper les réactions du post
          const reactions = await scrapeReactions(postUrl);
          console.log(`[scrape-linkedin] Found ${reactions.length} reactions on post`);

          for (const reaction of reactions) {
            await upsertEngager(supabase, savedPost.id, reaction);
            totalEngagers++;
          }

          // Mettre à jour le post avec le timestamp du dernier scrape
          await supabase
            .from('linkedin_posts')
            .update({ 
              last_scraped_at: new Date().toISOString(),
              likes_count: reactions.filter(r => r.reactionType !== 'comment').length,
              comments_count: reactions.filter(r => r.reactionType === 'comment').length,
            })
            .eq('id', savedPost.id);
        }

        // Mettre à jour les compteurs de la source
        const { count: postsCount } = await supabase
          .from('linkedin_posts')
          .select('*', { count: 'exact', head: true })
          .eq('source_id', source.id);

        const { count: engagersCount } = await supabase
          .from('linkedin_engagers')
          .select('*, linkedin_posts!inner(*)', { count: 'exact', head: true })
          .eq('linkedin_posts.source_id', source.id);

        await supabase
          .from('linkedin_sources')
          .update({ 
            last_scraped_at: new Date().toISOString(),
            posts_count: postsCount || 0,
            engagers_count: engagersCount || 0,
          })
          .eq('id', source.id);
      }

      // 5. Transférer automatiquement les engagers vers contacts
      await transferEngagersToContacts(supabase);

      // 6. Logger l'utilisation des crédits Apify
      await logApifyUsage(supabase, totalEngagers);

      console.log(`[scrape-linkedin] Full scan complete. Posts: ${totalNewPosts}, Engagers: ${totalEngagers}`);

      return new Response(JSON.stringify({ 
        success: true, 
        newPosts: totalNewPosts,
        engagersFound: totalEngagers 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== ACTION: Scraper un post spécifique ==========
    if (action === 'scrape_single' && postId) {
      const { data: post, error: postError } = await supabase
        .from('linkedin_posts')
        .select('*')
        .eq('id', postId)
        .single();

      if (postError) throw postError;

      console.log(`[scrape-linkedin] Scraping single post: ${post.post_url}`);

      const reactions = await scrapeReactions(post.post_url);
      let totalEngagers = 0;

      for (const reaction of reactions) {
        await upsertEngager(supabase, post.id, reaction);
        totalEngagers++;
      }

      await supabase
        .from('linkedin_posts')
        .update({ 
          last_scraped_at: new Date().toISOString(),
          likes_count: reactions.filter(r => r.reactionType !== 'comment').length,
          comments_count: reactions.filter(r => r.reactionType === 'comment').length,
        })
        .eq('id', post.id);

      return new Response(JSON.stringify({ 
        success: true, 
        engagersFound: totalEngagers,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ========== ACTION: Scraper les posts existants (legacy) ==========
    if (action === 'scrape') {
      const { data: posts, error: postsError } = await supabase
        .from('linkedin_posts')
        .select('*')
        .order('last_scraped_at', { ascending: true, nullsFirst: true })
        .limit(5);

      if (postsError) throw postsError;

      if (!posts || posts.length === 0) {
        return new Response(JSON.stringify({ 
          success: true, 
          message: 'No posts to scrape',
          engagersFound: 0 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let totalEngagers = 0;

      for (const post of posts) {
        const reactions = await scrapeReactions(post.post_url);
        
        for (const reaction of reactions) {
          await upsertEngager(supabase, post.id, reaction);
          totalEngagers++;
        }

        await supabase
          .from('linkedin_posts')
          .update({ last_scraped_at: new Date().toISOString() })
          .eq('id', post.id);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Scraped ${posts.length} posts`,
        engagersFound: totalEngagers 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scrape-linkedin] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Scraper les posts d'une source (profil ou company)
async function scrapePostsFromSource(actorId: string, sourceUrl: string): Promise<LinkedInPost[]> {
  try {
    console.log(`[scrape-linkedin] Starting actor ${actorId} for ${sourceUrl}`);
    
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: [sourceUrl],
          profileUrls: [sourceUrl], // Pour profilePosts
          companyUrls: [sourceUrl], // Pour companyPosts
          maxItems: 10, // Derniers 10 posts
        }),
      }
    );

    if (!runResponse.ok) {
      console.error(`[scrape-linkedin] Apify run failed: ${await runResponse.text()}`);
      return [];
    }

    const runData: ApifyRunResult = await runResponse.json();
    return await waitForApifyResults<LinkedInPost>(runData);
  } catch (error) {
    console.error('[scrape-linkedin] Error scraping posts:', error);
    return [];
  }
}

// Scraper les réactions d'un post
async function scrapeReactions(postUrl: string): Promise<LinkedInReaction[]> {
  try {
    console.log(`[scrape-linkedin] Scraping reactions for: ${postUrl}`);
    
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTORS.postReactions}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUrls: [postUrl],
          urls: [postUrl],
          maxItems: 100,
        }),
      }
    );

    if (!runResponse.ok) {
      console.error(`[scrape-linkedin] Apify reactions run failed: ${await runResponse.text()}`);
      return [];
    }

    const runData: ApifyRunResult = await runResponse.json();
    return await waitForApifyResults<LinkedInReaction>(runData);
  } catch (error) {
    console.error('[scrape-linkedin] Error scraping reactions:', error);
    return [];
  }
}

// Attendre les résultats Apify
async function waitForApifyResults<T>(runData: ApifyRunResult): Promise<T[]> {
  const runId = runData.data.id;
  console.log(`[scrape-linkedin] Started Apify run: ${runId}`);

  let status = runData.data.status;
  let attempts = 0;
  const maxAttempts = 30; // 2.5 minutes max

  while (status !== 'SUCCEEDED' && status !== 'FAILED' && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const statusResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
    );
    const statusData = await statusResponse.json();
    status = statusData.data.status;
    attempts++;
    
    console.log(`[scrape-linkedin] Run status: ${status} (attempt ${attempts})`);
  }

  if (status !== 'SUCCEEDED') {
    console.error(`[scrape-linkedin] Apify run did not succeed: ${status}`);
    return [];
  }

  const datasetId = runData.data.defaultDatasetId;
  const dataResponse = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
  );

  if (!dataResponse.ok) {
    console.error('[scrape-linkedin] Failed to fetch dataset');
    return [];
  }

  return await dataResponse.json();
}

// Insérer/mettre à jour un engager
async function upsertEngager(supabase: any, postId: string, reaction: LinkedInReaction) {
  const name = reaction.name || reaction.fullName || 'Unknown';
  const linkedinUrl = reaction.profileUrl || reaction.linkedinUrl;
  const headline = reaction.headline;
  const engagementType = reaction.reactionType === 'comment' ? 'comment' : 'like';

  // Extraire l'entreprise du headline
  let company = reaction.company;
  if (!company && headline) {
    const atMatch = headline.match(/(?:at|@|chez)\s+([^|,]+)/i);
    if (atMatch) company = atMatch[1].trim();
  }

  const { error } = await supabase
    .from('linkedin_engagers')
    .upsert({
      post_id: postId,
      name,
      headline,
      company,
      linkedin_url: linkedinUrl,
      engagement_type: engagementType,
      comment_text: reaction.comment || null,
      scraped_at: new Date().toISOString(),
      is_prospect: true, // Automatiquement prospect
      transferred_to_contacts: false,
    }, { 
      onConflict: 'post_id,linkedin_url,engagement_type',
      ignoreDuplicates: true 
    });

  if (error && !error.message.includes('duplicate')) {
    console.error('[scrape-linkedin] Error upserting engager:', error);
  }
}

// Transférer automatiquement les engagers vers contacts
async function transferEngagersToContacts(supabase: any) {
  const { data: engagers, error } = await supabase
    .from('linkedin_engagers')
    .select('*')
    .eq('transferred_to_contacts', false)
    .eq('is_prospect', true);

  if (error || !engagers) return;

  console.log(`[scrape-linkedin] Transferring ${engagers.length} engagers to contacts`);

  for (const engager of engagers) {
    // Créer un signal LinkedIn pour cet engager
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .insert({
        company_name: engager.company || engager.name,
        signal_type: 'linkedin_engagement',
        source_name: 'LinkedIn',
        source_url: engager.linkedin_url,
        event_detail: `${engager.engagement_type === 'comment' ? 'Commentaire' : 'Like'} sur post LinkedIn`,
        score: 70,
        status: 'new',
      })
      .select()
      .single();

    if (signalError) {
      console.error('[scrape-linkedin] Error creating signal:', signalError);
      continue;
    }

    // Créer un enrichment placeholder
    const { data: enrichment, error: enrichmentError } = await supabase
      .from('company_enrichment')
      .insert({
        signal_id: signal.id,
        company_name: engager.company || engager.name,
        status: 'pending',
      })
      .select()
      .single();

    if (enrichmentError) {
      console.error('[scrape-linkedin] Error creating enrichment:', enrichmentError);
      continue;
    }

    // Créer le contact
    const { error: contactError } = await supabase
      .from('contacts')
      .insert({
        signal_id: signal.id,
        enrichment_id: enrichment.id,
        full_name: engager.name,
        job_title: engager.headline,
        linkedin_url: engager.linkedin_url,
        outreach_status: 'new',
        notes: `Source: LinkedIn engagement (${engager.engagement_type})`,
      });

    if (contactError) {
      console.error('[scrape-linkedin] Error creating contact:', contactError);
      continue;
    }

    // Marquer l'engager comme transféré
    await supabase
      .from('linkedin_engagers')
      .update({ 
        transferred_to_contacts: true,
        contact_id: signal.id, // Lien vers le signal
      })
      .eq('id', engager.id);
  }
}

// Logger l'utilisation des crédits Apify
async function logApifyUsage(supabase: any, scrapesCount: number) {
  const creditsUsed = scrapesCount * 0.5; // Estimation
  
  await supabase
    .from('apify_credit_usage')
    .insert({
      source: 'linkedin',
      scrapes_count: scrapesCount,
      credits_used: creditsUsed,
      details: { action: 'full_scan' },
    });
}

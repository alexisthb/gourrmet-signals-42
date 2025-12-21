import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Apify actors - utilisation de harvestapi (no-cookie, meilleur taux de succès)
const APIFY_ACTORS = {
  profilePosts: 'harvestapi~linkedin-profile-posts',
  companyPosts: 'harvestapi~linkedin-company-posts', 
  postReactions: 'harvestapi~linkedin-post-reactions', // NO COOKIE required
};

interface ApifyRunResult {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

// Structure retournée par harvestapi pour les posts
interface LinkedInPost {
  // harvestapi fields - champ principal!
  linkedinUrl?: string;
  // autres champs possibles
  postUrl?: string;
  url?: string;
  shareUrl?: string;
  shareUrn?: string;
  urn?: string;
  activityUrn?: string;
  entityId?: string;
  // content
  text?: string;
  content?: string;
  commentary?: string;
  // dates
  publishedAt?: string;
  postedAt?: string;
  date?: string;
  postedDate?: string;
  postedDateTimestamp?: number;
  // engagement
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  numLikes?: number;
  numComments?: number;
  numShares?: number;
  engagement?: {
    numLikes?: number;
    numComments?: number;
    numShares?: number;
  };
  socialActivity?: {
    numReactions?: number;
    numComments?: number;
    numShares?: number;
  };
}

// Structure retournée par harvestapi pour les réactions
interface LinkedInReaction {
  // harvestapi fields - le format actuel met tout dans un objet "actor"
  actor?: {
    name?: string;
    headline?: string;
    url?: string;
    publicIdentifier?: string;
    profileUrl?: string;
    linkedinUrl?: string;
    company?: string;
    firstName?: string;
    lastName?: string;
  };
  // legacy/flat fields
  profileUrl?: string;
  publicIdentifier?: string;
  linkedinUrl?: string;
  profileLink?: string;
  actorUrn?: string;
  // name fields
  actor_name?: string;
  name?: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  // other fields
  actor_headline?: string;
  headline?: string;
  occupation?: string;
  company?: string;
  reactionType?: string;
  reaction_type?: string;
  type?: string;
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
    const { action, postUrl, postId, sourceId, maxPosts = 4 } = await req.json();
    
    console.log(`[scrape-linkedin] Action: ${action}, maxPosts: ${maxPosts}`);

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
        
        const posts = await scrapePostsFromSource(source.linkedin_url, source.source_type, maxPosts);
        console.log(`[scrape-linkedin] Found ${posts.length} posts from ${source.name}`);

        // 3. Pour chaque post, l'insérer et scraper les réactions
        for (const post of posts) {
          // Extraire l'URL du post - harvestapi utilise différents champs
          const postUrlValue = extractPostUrl(post);
          
          if (!postUrlValue) {
            console.log('[scrape-linkedin] Post without URL, raw data:', JSON.stringify(post).substring(0, 200));
            continue;
          }

          console.log(`[scrape-linkedin] Processing post: ${postUrlValue.substring(0, 80)}...`);

          // Insérer/mettre à jour le post
          const postContent = post.text || post.content || post.commentary || '';
          const { data: savedPost, error: postError } = await supabase
            .from('linkedin_posts')
            .upsert({
              post_url: postUrlValue,
              source_id: source.id,
              title: postContent.substring(0, 100) || 'Post LinkedIn',
              content: postContent,
              published_at: extractPublishedAt(post),
              likes_count: post.likesCount || post.numLikes || post.engagement?.numLikes || post.socialActivity?.numReactions || 0,
              comments_count: post.commentsCount || post.numComments || post.engagement?.numComments || post.socialActivity?.numComments || 0,
              shares_count: post.sharesCount || post.numShares || post.engagement?.numShares || post.socialActivity?.numShares || 0,
            }, { onConflict: 'post_url' })
            .select()
            .single();

          if (postError) {
            console.error('[scrape-linkedin] Error saving post:', postError);
            continue;
          }

          totalNewPosts++;

          // 4. Scraper les réactions du post
          const reactions = await scrapeReactions(postUrlValue);
          console.log(`[scrape-linkedin] Found ${reactions.length} reactions on post`);

          for (const reaction of reactions) {
            const success = await upsertEngager(supabase, savedPost.id, reaction);
            if (success) totalEngagers++;
          }

          // Mettre à jour le post avec le timestamp du dernier scrape
          await supabase
            .from('linkedin_posts')
            .update({ 
              last_scraped_at: new Date().toISOString(),
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
        const success = await upsertEngager(supabase, post.id, reaction);
        if (success) totalEngagers++;
      }

      await supabase
        .from('linkedin_posts')
        .update({ 
          last_scraped_at: new Date().toISOString(),
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
          const success = await upsertEngager(supabase, post.id, reaction);
          if (success) totalEngagers++;
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

// Extraire l'URL du post depuis les différents champs possibles
function extractPostUrl(post: LinkedInPost): string | null {
  // Priorité: linkedinUrl (harvestapi) > postUrl > shareUrl > url > construction depuis urn
  if (post.linkedinUrl) return post.linkedinUrl;
  if (post.postUrl) return post.postUrl;
  if (post.shareUrl) return post.shareUrl;
  if (post.url) return post.url;
  
  // Si on a un URN (shareUrn, urn, activityUrn, entityId), construire l'URL
  const urnValue = post.shareUrn || post.urn || post.activityUrn || post.entityId;
  if (urnValue) {
    // Format: urn:li:activity:7388719843178442752 ou urn:li:ugcPost:7388719843178442752 ou juste l'ID
    const match = urnValue.match(/(?:urn:li:(?:activity|ugcPost|share):)?(\d+)/);
    if (match) {
      return `https://www.linkedin.com/feed/update/urn:li:activity:${match[1]}`;
    }
  }
  
  return null;
}

function normalizeToDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    // cas: JSON stringifié (ex: "{\"timestamp\":...,\"date\":...}")
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        return normalizeToDate(JSON.parse(trimmed));
      } catch {
        // ignore
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }

  if (typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }

  if (typeof value === 'object') {
    const v = value as any;
    if (typeof v.date === 'string') return normalizeToDate(v.date);
    if (typeof v.timestamp === 'number') return normalizeToDate(v.timestamp);
    if (typeof v.postedDateTimestamp === 'number') return normalizeToDate(v.postedDateTimestamp);
  }

  return null;
}

function extractPublishedAt(post: LinkedInPost): string | null {
  const p = post as any;
  return normalizeToDate(
    p.publishedAt ?? p.postedAt ?? p.date ?? p.postedDate ?? p.postedDateTimestamp ?? null,
  );
}

// Scraper les posts d'une source (profil ou company)
async function scrapePostsFromSource(sourceUrl: string, sourceType: string, maxPosts: number): Promise<LinkedInPost[]> {
  try {
    const actorId = sourceType === 'profile' 
      ? APIFY_ACTORS.profilePosts 
      : APIFY_ACTORS.companyPosts;
    
    console.log(`[scrape-linkedin] Starting actor ${actorId} for ${sourceUrl}`);
    
    // harvestapi~linkedin-*-posts attend "targetUrls" (liste d'URLs de profils ou de pages)
    // Docs: https://apify.com/harvestapi/linkedin-profile-posts
    //       https://apify.com/harvestapi/linkedin-company-posts
    const input: Record<string, unknown> = {
      targetUrls: [sourceUrl],
      maxPosts,
    };

    console.log(`[scrape-linkedin] Actor input:`, JSON.stringify(input));

    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error(`[scrape-linkedin] Apify run failed: ${errorText}`);
      return [];
    }

    const runData: ApifyRunResult = await runResponse.json();
    return await waitForApifyResults<LinkedInPost>(runData, 60);
  } catch (error) {
    console.error('[scrape-linkedin] Error scraping posts:', error);
    return [];
  }
}

// Scraper les réactions d'un post avec harvestapi (NO COOKIE)
async function scrapeReactions(postUrl: string): Promise<LinkedInReaction[]> {
  try {
    console.log(`[scrape-linkedin] Scraping reactions for: ${postUrl}`);
    
    // harvestapi~linkedin-post-reactions (NO COOKIE)
    // Input: posts (array d'URLs), maxItems (int)
    const input = {
      posts: [postUrl],
      maxItems: 100,
    };

    console.log(`[scrape-linkedin] Reactions input:`, JSON.stringify(input));

    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTORS.postReactions}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error(`[scrape-linkedin] Apify reactions run failed: ${errorText}`);
      return [];
    }

    const runData: ApifyRunResult = await runResponse.json();
    return await waitForApifyResults<LinkedInReaction>(runData, 30);
  } catch (error) {
    console.error('[scrape-linkedin] Error scraping reactions:', error);
    return [];
  }
}

// Attendre les résultats Apify avec timeout
async function waitForApifyResults<T>(runData: ApifyRunResult, maxWaitSeconds: number = 30): Promise<T[]> {
  const runId = runData.data.id;
  console.log(`[scrape-linkedin] Started Apify run: ${runId}`);

  let status = runData.data.status;
  const startTime = Date.now();
  const maxWaitMs = maxWaitSeconds * 1000;

  while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED') {
    if (Date.now() - startTime > maxWaitMs) {
      console.log(`[scrape-linkedin] Apify run timeout after ${maxWaitSeconds}s, status: ${status}`);
      break;
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusResponse.json();
      status = statusData.data.status;
      console.log(`[scrape-linkedin] Run status: ${status}`);
    } catch (e) {
      console.error('[scrape-linkedin] Error checking status:', e);
      break;
    }
  }

  if (status !== 'SUCCEEDED') {
    console.error(`[scrape-linkedin] Apify run did not succeed: ${status}`);
    return [];
  }

  try {
    const datasetId = runData.data.defaultDatasetId;
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    );

    if (!dataResponse.ok) {
      console.error('[scrape-linkedin] Failed to fetch dataset');
      return [];
    }

    const results = await dataResponse.json();
    console.log(`[scrape-linkedin] Got ${results.length} results from dataset`);
    
    // Log first result for debugging
    if (results.length > 0) {
      console.log(`[scrape-linkedin] Sample result keys:`, Object.keys(results[0]).join(', '));
    }
    
    return results;
  } catch (e) {
    console.error('[scrape-linkedin] Error fetching dataset:', e);
    return [];
  }
}

// Insérer/mettre à jour un engager
async function upsertEngager(supabase: any, postId: string, reaction: LinkedInReaction): Promise<boolean> {
  // Extraire les données de l'objet "actor" si présent (format actuel harvestapi)
  const actor = reaction.actor;
  
  const name = actor?.name || actor?.firstName && actor?.lastName 
    ? `${actor.firstName} ${actor.lastName}`.trim()
    : reaction.actor_name || reaction.name || reaction.fullName || 
      [reaction.firstName, reaction.lastName].filter(Boolean).join(' ') || 'Unknown';
  
  if (name === 'Unknown' || !name.trim()) {
    console.log('[scrape-linkedin] Skipping engager without name, raw:', JSON.stringify(reaction).substring(0, 200));
    return false;
  }
  
  // Construire l'URL LinkedIn depuis différentes sources
  let linkedinUrl = actor?.url || actor?.profileUrl || actor?.linkedinUrl ||
    reaction.profileUrl || reaction.linkedinUrl || reaction.profileLink;
  
  const publicId = actor?.publicIdentifier || reaction.publicIdentifier;
  if (!linkedinUrl && publicId) {
    linkedinUrl = `https://www.linkedin.com/in/${publicId}`;
  }
  
  const headline = actor?.headline || reaction.actor_headline || reaction.headline || reaction.occupation;
  const reactionType = reaction.reaction_type || reaction.reactionType || reaction.type;
  const engagementType = reactionType === 'comment' ? 'comment' : 'like';

  // Extraire l'entreprise
  let company = actor?.company || reaction.company;
  if (!company && headline) {
    const atMatch = headline.match(/(?:at|@|chez|à)\s+([^|,•\-]+)/i);
    if (atMatch) company = atMatch[1].trim();
  }

  console.log(`[scrape-linkedin] Upserting engager: ${name} (${engagementType}), url: ${linkedinUrl || 'none'}`);

  try {
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
        is_prospect: true,
        transferred_to_contacts: false,
      }, { 
        onConflict: 'post_id,linkedin_url,engagement_type',
        ignoreDuplicates: true 
      });

    if (error && !error.message?.includes('duplicate')) {
      console.error('[scrape-linkedin] Error upserting engager:', error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[scrape-linkedin] Exception upserting engager:', e);
    return false;
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

  // Pour chaque engager prospect, créer un contact s'il n'existe pas
  for (const engager of engagers) {
    // Vérifier si ce contact existe déjà
    const { data: existingContact } = await supabase
      .from('linkedin_engagers')
      .select('contact_id')
      .eq('linkedin_url', engager.linkedin_url)
      .not('contact_id', 'is', null)
      .limit(1)
      .single();

    if (existingContact?.contact_id) {
      // Marquer comme transféré
      await supabase
        .from('linkedin_engagers')
        .update({ 
          transferred_to_contacts: true,
          contact_id: existingContact.contact_id 
        })
        .eq('id', engager.id);
    }
  }
}

// Logger l'utilisation des crédits Apify
async function logApifyUsage(supabase: any, engagersCount: number) {
  const creditsUsed = Math.ceil(engagersCount * 0.002 * 100) / 100; // $0.002 par engager environ
  
  await supabase
    .from('apify_credit_usage')
    .insert({
      date: new Date().toISOString().split('T')[0],
      credits_used: creditsUsed,
      scrapes_count: engagersCount,
      source: 'linkedin',
      details: { type: 'linkedin_scan', engagers: engagersCount }
    });
}

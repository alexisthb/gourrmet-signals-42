import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APIFY_API_KEY = Deno.env.get('APIFY_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Apify actors for LinkedIn scraping
const APIFY_ACTORS = {
  postLikers: 'curious_coder/linkedin-post-likers',
  postCommenters: 'curious_coder/linkedin-post-comments',
};

interface ApifyRunResult {
  data: {
    id: string;
    status: string;
    defaultDatasetId: string;
  };
}

interface LinkedInEngager {
  name?: string;
  fullName?: string;
  headline?: string;
  profileUrl?: string;
  linkedinUrl?: string;
  company?: string;
  occupation?: string;
  comment?: string;
  text?: string;
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

    const { action, postUrl, postId } = await req.json();
    console.log(`[scrape-linkedin-engagers] Action: ${action}, Post URL: ${postUrl}`);

    if (action === 'add_post') {
      // Add a new post to track
      const { data: post, error } = await supabase
        .from('linkedin_posts')
        .upsert({
          post_url: postUrl,
          title: `Post LinkedIn`,
        }, { onConflict: 'post_url' })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, post }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'scrape') {
      // Get all posts to scrape
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
        console.log(`[scrape-linkedin-engagers] Scraping post: ${post.post_url}`);
        
        // Scrape likers
        const likers = await scrapeWithApify(APIFY_ACTORS.postLikers, post.post_url);
        console.log(`[scrape-linkedin-engagers] Found ${likers.length} likers`);
        
        for (const liker of likers) {
          await upsertEngager(supabase, post.id, liker, 'like');
          totalEngagers++;
        }

        // Scrape commenters
        const commenters = await scrapeWithApify(APIFY_ACTORS.postCommenters, post.post_url);
        console.log(`[scrape-linkedin-engagers] Found ${commenters.length} commenters`);
        
        for (const commenter of commenters) {
          await upsertEngager(supabase, post.id, commenter, 'comment');
          totalEngagers++;
        }

        // Update last scraped timestamp
        await supabase
          .from('linkedin_posts')
          .update({ 
            last_scraped_at: new Date().toISOString(),
            likes_count: likers.length,
            comments_count: commenters.length,
          })
          .eq('id', post.id);
      }

      console.log(`[scrape-linkedin-engagers] Scraping complete. Total engagers: ${totalEngagers}`);

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Scraped ${posts.length} posts`,
        engagersFound: totalEngagers 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'scrape_single' && postId) {
      // Scrape a single post
      const { data: post, error: postError } = await supabase
        .from('linkedin_posts')
        .select('*')
        .eq('id', postId)
        .single();

      if (postError) throw postError;

      console.log(`[scrape-linkedin-engagers] Scraping single post: ${post.post_url}`);

      let totalEngagers = 0;

      // Scrape likers
      const likers = await scrapeWithApify(APIFY_ACTORS.postLikers, post.post_url);
      for (const liker of likers) {
        await upsertEngager(supabase, post.id, liker, 'like');
        totalEngagers++;
      }

      // Scrape commenters  
      const commenters = await scrapeWithApify(APIFY_ACTORS.postCommenters, post.post_url);
      for (const commenter of commenters) {
        await upsertEngager(supabase, post.id, commenter, 'comment');
        totalEngagers++;
      }

      // Update post stats
      await supabase
        .from('linkedin_posts')
        .update({ 
          last_scraped_at: new Date().toISOString(),
          likes_count: likers.length,
          comments_count: commenters.length,
        })
        .eq('id', post.id);

      return new Response(JSON.stringify({ 
        success: true, 
        engagersFound: totalEngagers,
        likes: likers.length,
        comments: commenters.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[scrape-linkedin-engagers] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function scrapeWithApify(actorId: string, postUrl: string): Promise<LinkedInEngager[]> {
  try {
    // Start the actor run
    const runResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/runs?token=${APIFY_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postUrls: [postUrl],
          maxItems: 100,
        }),
      }
    );

    if (!runResponse.ok) {
      const errorText = await runResponse.text();
      console.error(`[scrape-linkedin-engagers] Apify run failed: ${errorText}`);
      return [];
    }

    const runData: ApifyRunResult = await runResponse.json();
    const runId = runData.data.id;

    console.log(`[scrape-linkedin-engagers] Started Apify run: ${runId}`);

    // Wait for the run to complete (poll every 5 seconds, max 2 minutes)
    let status = runData.data.status;
    let attempts = 0;
    const maxAttempts = 24;

    while (status !== 'SUCCEEDED' && status !== 'FAILED' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const statusResponse = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_KEY}`
      );
      const statusData = await statusResponse.json();
      status = statusData.data.status;
      attempts++;
      
      console.log(`[scrape-linkedin-engagers] Run status: ${status} (attempt ${attempts})`);
    }

    if (status !== 'SUCCEEDED') {
      console.error(`[scrape-linkedin-engagers] Apify run did not succeed: ${status}`);
      return [];
    }

    // Get the results from the dataset
    const datasetId = runData.data.defaultDatasetId;
    const dataResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_KEY}`
    );

    if (!dataResponse.ok) {
      console.error('[scrape-linkedin-engagers] Failed to fetch dataset');
      return [];
    }

    const results = await dataResponse.json();
    return results as LinkedInEngager[];

  } catch (error) {
    console.error('[scrape-linkedin-engagers] Apify error:', error);
    return [];
  }
}

async function upsertEngager(
  supabase: any,
  postId: string,
  engager: LinkedInEngager,
  engagementType: 'like' | 'comment' | 'share'
) {
  const name = engager.name || engager.fullName || 'Unknown';
  const linkedinUrl = engager.profileUrl || engager.linkedinUrl;
  const headline = engager.headline || engager.occupation;
  const commentText = engager.comment || engager.text;

  // Extract company from headline if possible
  let company = engager.company;
  if (!company && headline) {
    const atMatch = headline.match(/(?:at|@|chez)\s+([^|,]+)/i);
    if (atMatch) {
      company = atMatch[1].trim();
    }
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
      comment_text: commentText,
      scraped_at: new Date().toISOString(),
    }, { 
      onConflict: 'post_id,linkedin_url,engagement_type',
      ignoreDuplicates: true 
    });

  if (error && !error.message.includes('duplicate')) {
    console.error('[scrape-linkedin-engagers] Error upserting engager:', error);
  }
}

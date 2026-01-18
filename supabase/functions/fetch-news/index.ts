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

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Create client with user's auth token for validation
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validate JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Authenticated user:', claimsData.claims.sub);
    console.log('Starting fetch-news function');

    // Create service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get NewsAPI key from environment only (not from settings table)
    const newsapiKey = Deno.env.get('NEWSAPI_KEY');
    if (!newsapiKey) {
      throw new Error('NewsAPI key not configured in environment. Please add NEWSAPI_KEY secret.');
    }

    // Get days to fetch setting
    const { data: daysSetting } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'days_to_fetch')
      .single()
    
    const daysToFetch = parseInt(daysSetting?.value || '1')
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - daysToFetch)
    const fromDateStr = fromDate.toISOString().split('T')[0]

    console.log(`Fetching news from ${fromDateStr}`)

    // Get active search queries
    const { data: queries, error: queriesError } = await supabase
      .from('search_queries')
      .select('*')
      .eq('is_active', true)

    if (queriesError) {
      console.error('Error fetching queries:', queriesError)
      throw queriesError
    }

    console.log(`Found ${queries?.length || 0} active queries`)

    let totalArticles = 0
    let newArticles = 0
    let totalRequests = 0

    for (const query of queries || []) {
      try {
        console.log(`Processing query: ${query.name}`)

        // Build NewsAPI URL
        const newsUrl = new URL('https://newsapi.org/v2/everything')
        newsUrl.searchParams.set('q', query.query)
        newsUrl.searchParams.set('language', 'fr')
        newsUrl.searchParams.set('sortBy', 'publishedAt')
        newsUrl.searchParams.set('from', fromDateStr)
        newsUrl.searchParams.set('pageSize', '50')
        newsUrl.searchParams.set('apiKey', newsapiKey)

        const response = await fetch(newsUrl.toString())
        totalRequests++ // Count each API request
        
        if (!response.ok) {
          const errorText = await response.text()
          console.error(`NewsAPI error for query "${query.name}": ${response.status} - ${errorText}`)
          
          // Track the failed request too
          await supabase
            .from('newsapi_usage')
            .insert({
              date: new Date().toISOString().split('T')[0],
              requests_count: 1,
              articles_fetched: 0,
              query_id: query.id,
              details: { error: errorText, status: response.status }
            })
          
          continue
        }

        const data = await response.json()
        
        if (data.status !== 'ok') {
          console.error(`NewsAPI returned error for query "${query.name}":`, data.message)
          continue
        }

        const articles = data.articles || []
        totalArticles += articles.length
        console.log(`Found ${articles.length} articles for query "${query.name}"`)

        let articlesInserted = 0
        for (const article of articles) {
          if (!article.url) continue

          // Check if article already exists
          const { data: existing } = await supabase
            .from('raw_articles')
            .select('id')
            .eq('url', article.url)
            .maybeSingle()

          if (!existing) {
            const { error: insertError } = await supabase
              .from('raw_articles')
              .insert({
                query_id: query.id,
                title: article.title || 'Sans titre',
                description: article.description,
                content: article.content,
                url: article.url,
                source_name: article.source?.name,
                author: article.author,
                image_url: article.urlToImage,
                published_at: article.publishedAt ? new Date(article.publishedAt).toISOString() : null,
              })

            if (!insertError) {
              newArticles++
              articlesInserted++
            } else {
              console.error('Error inserting article:', insertError)
            }
          }
        }

        // Track usage for this query
        await supabase
          .from('newsapi_usage')
          .insert({
            date: new Date().toISOString().split('T')[0],
            requests_count: 1,
            articles_fetched: articlesInserted,
            query_id: query.id,
            details: { 
              query_name: query.name,
              total_results: data.totalResults || 0,
              articles_received: articles.length
            }
          })

        // Update last_fetched_at
        await supabase
          .from('search_queries')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('id', query.id)

        // Rate limit pause
        await new Promise(resolve => setTimeout(resolve, 500))

      } catch (queryError) {
        console.error(`Error processing query "${query.name}":`, queryError)
      }
    }

    console.log(`Fetch complete: ${newArticles} new articles saved out of ${totalArticles} total (${totalRequests} API requests)`)

    return new Response(
      JSON.stringify({ 
        success: true, 
        queries_processed: queries?.length || 0,
        total_articles_found: totalArticles,
        new_articles_saved: newArticles,
        api_requests: totalRequests
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error in fetch-news:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

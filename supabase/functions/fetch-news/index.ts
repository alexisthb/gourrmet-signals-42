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
    console.log('Starting fetch-news function')

    // Get NewsAPI key from settings
    const { data: newsapiSetting, error: settingError } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'newsapi_key')
      .single()

    if (settingError) {
      console.error('Error fetching newsapi_key setting:', settingError)
    }

    const newsapiKey = newsapiSetting?.value
    if (!newsapiKey) {
      throw new Error('NewsAPI key not configured. Please add your API key in Settings.')
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

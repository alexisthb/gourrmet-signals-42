import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_BATCHES_PER_SCAN = 10 // Maximum 10 batches = 300 articles max
const PAUSE_BETWEEN_BATCHES_MS = 3000 // 3 seconds pause between batches

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Create scan log
  const { data: scanLog, error: logError } = await supabase
    .from('scan_logs')
    .insert({ status: 'running' })
    .select()
    .single()

  if (logError) {
    console.error('Error creating scan log:', logError)
  }

  console.log('Starting full scan, log id:', scanLog?.id)

  try {
    // Step 1: Fetch news
    console.log('Step 1: Fetching news...')
    const fetchResponse = await fetch(`${supabaseUrl}/functions/v1/fetch-news`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })
    const fetchResult = await fetchResponse.json()

    if (!fetchResult.success) {
      throw new Error(`Fetch failed: ${fetchResult.error}`)
    }

    console.log('Fetch result:', fetchResult)

    // Pause to let inserts complete
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 2: Analyze articles in batches
    console.log('Step 2: Analyzing articles in batches...')
    
    let totalArticlesProcessed = 0
    let totalSignalsCreated = 0
    let batchNumber = 0
    let hasMoreArticles = true

    while (hasMoreArticles && batchNumber < MAX_BATCHES_PER_SCAN) {
      batchNumber++
      console.log(`Starting batch ${batchNumber}/${MAX_BATCHES_PER_SCAN}...`)

      const analyzeResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-articles`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      })
      const analyzeResult = await analyzeResponse.json()

      if (!analyzeResult.success) {
        console.error(`Batch ${batchNumber} failed:`, analyzeResult.error)
        // Continue with next batch instead of failing entirely
        break
      }

      const articlesProcessed = analyzeResult.articles_processed || 0
      const signalsCreated = analyzeResult.signals_created || 0

      totalArticlesProcessed += articlesProcessed
      totalSignalsCreated += signalsCreated

      console.log(`Batch ${batchNumber} complete: ${articlesProcessed} articles, ${signalsCreated} signals`)

      // Stop if no articles were processed (all done) or fewer than 30 (last batch)
      if (articlesProcessed === 0 || articlesProcessed < 30) {
        hasMoreArticles = false
        console.log('No more articles to process')
      } else {
        // Pause between batches to avoid rate limits
        console.log(`Pausing ${PAUSE_BETWEEN_BATCHES_MS}ms before next batch...`)
        await new Promise(resolve => setTimeout(resolve, PAUSE_BETWEEN_BATCHES_MS))
      }
    }

    if (batchNumber >= MAX_BATCHES_PER_SCAN && hasMoreArticles) {
      console.log(`Reached max batches (${MAX_BATCHES_PER_SCAN}), some articles may remain unprocessed`)
    }

    // Update scan log
    if (scanLog) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          articles_fetched: fetchResult.new_articles_saved || 0,
          articles_analyzed: totalArticlesProcessed,
          signals_created: totalSignalsCreated,
          status: 'completed'
        })
        .eq('id', scanLog.id)
    }

    console.log(`Full scan completed: ${batchNumber} batches, ${totalArticlesProcessed} articles analyzed, ${totalSignalsCreated} signals created`)

    return new Response(
      JSON.stringify({ 
        success: true,
        fetch: fetchResult,
        analyze: {
          batches_run: batchNumber,
          articles_processed: totalArticlesProcessed,
          signals_created: totalSignalsCreated
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    
    // Update log on error
    if (scanLog) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          status: 'failed',
          error_message: errorMessage
        })
        .eq('id', scanLog.id)
    }

    console.error('Error in run-full-scan:', error)
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

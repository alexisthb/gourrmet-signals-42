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

    // Step 2: Analyze articles
    console.log('Step 2: Analyzing articles...')
    const analyzeResponse = await fetch(`${supabaseUrl}/functions/v1/analyze-articles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      }
    })
    const analyzeResult = await analyzeResponse.json()

    console.log('Analyze result:', analyzeResult)

    // Update scan log
    if (scanLog) {
      await supabase
        .from('scan_logs')
        .update({
          completed_at: new Date().toISOString(),
          articles_fetched: fetchResult.new_articles_saved || 0,
          articles_analyzed: analyzeResult.articles_processed || 0,
          signals_created: analyzeResult.signals_created || 0,
          status: 'completed'
        })
        .eq('id', scanLog.id)
    }

    console.log('Full scan completed successfully')

    return new Response(
      JSON.stringify({ 
        success: true,
        fetch: fetchResult,
        analyze: analyzeResult
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

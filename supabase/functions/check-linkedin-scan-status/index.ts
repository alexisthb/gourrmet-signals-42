import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MANUS_API_KEY = Deno.env.get('MANUS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { scan_id, manus_task_id } = await req.json();

    console.log(`[check-linkedin-scan] Checking scan status: ${scan_id || manus_task_id}`);

    if (!MANUS_API_KEY) {
      throw new Error('MANUS_API_KEY is not configured');
    }

    // Récupérer le scan
    let scanRecord;
    if (scan_id) {
      const { data, error } = await supabase
        .from('linkedin_scan_progress')
        .select('*')
        .eq('id', scan_id)
        .single();
      if (error) throw error;
      scanRecord = data;
    } else if (manus_task_id) {
      const { data, error } = await supabase
        .from('linkedin_scan_progress')
        .select('*')
        .eq('manus_task_id', manus_task_id)
        .single();
      if (error) throw error;
      scanRecord = data;
    } else {
      throw new Error('scan_id or manus_task_id required');
    }

    if (!scanRecord) {
      throw new Error('Scan not found');
    }

    // Si déjà terminé, retourner le résultat
    if (scanRecord.status === 'completed' || scanRecord.status === 'error') {
      return new Response(JSON.stringify({
        success: true,
        scan: scanRecord,
        is_complete: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Vérifier le statut Manus
    console.log(`[check-linkedin-scan] Fetching Manus task: ${scanRecord.manus_task_id}`);
    
    const manusResponse = await fetch(`https://api.manus.ai/v1/tasks/${scanRecord.manus_task_id}`, {
      headers: {
        'Authorization': `Bearer ${MANUS_API_KEY}`,
      },
    });

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error(`[check-linkedin-scan] Manus API error: ${errorText}`);
      throw new Error(`Manus API error: ${manusResponse.status}`);
    }

    const manusTask = await manusResponse.json();
    console.log(`[check-linkedin-scan] Manus task status: ${manusTask.status}`);

    // Mapper le statut Manus
    let newStatus = scanRecord.status;
    let isComplete = false;

    if (manusTask.status === 'completed' || manusTask.status === 'done') {
      newStatus = 'completed';
      isComplete = true;
    } else if (manusTask.status === 'failed' || manusTask.status === 'error') {
      newStatus = 'error';
      isComplete = true;
    } else if (manusTask.status === 'running' || manusTask.status === 'in_progress') {
      newStatus = 'manus_processing';
    }

    // Si terminé, traiter les résultats
    if (isComplete && manusTask.status === 'completed') {
      console.log(`[check-linkedin-scan] Processing Manus results...`);
      
      const results = manusTask.output || manusTask.result || manusTask.data;
      
      // Parser les résultats et insérer les données
      const processedData = await processManusResults(supabase, results, scanRecord);

      await supabase
        .from('linkedin_scan_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          posts_found: processedData.posts_found,
          engagers_found: processedData.engagers_found,
          contacts_enriched: processedData.contacts_enriched,
          results: results,
        })
        .eq('id', scanRecord.id);

      return new Response(JSON.stringify({
        success: true,
        scan: {
          ...scanRecord,
          status: 'completed',
          posts_found: processedData.posts_found,
          engagers_found: processedData.engagers_found,
          contacts_enriched: processedData.contacts_enriched,
        },
        is_complete: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Si erreur
    if (isComplete && newStatus === 'error') {
      await supabase
        .from('linkedin_scan_progress')
        .update({
          status: 'error',
          completed_at: new Date().toISOString(),
          error_message: manusTask.error || 'Unknown error from Manus',
        })
        .eq('id', scanRecord.id);
    }

    // Mettre à jour le statut si changé
    if (newStatus !== scanRecord.status) {
      await supabase
        .from('linkedin_scan_progress')
        .update({ status: newStatus })
        .eq('id', scanRecord.id);
    }

    return new Response(JSON.stringify({
      success: true,
      scan: {
        ...scanRecord,
        status: newStatus,
      },
      is_complete: isComplete,
      manus_status: manusTask.status,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[check-linkedin-scan] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Traiter les résultats Manus et insérer dans la DB
async function processManusResults(supabase: any, results: any, scanRecord: any) {
  let posts_found = 0;
  let engagers_found = 0;
  let contacts_enriched = 0;

  try {
    // Parser le JSON si c'est une string
    let data = results;
    if (typeof results === 'string') {
      // Chercher le bloc JSON dans le texte
      const jsonMatch = results.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        data = JSON.parse(jsonMatch[1]);
      } else {
        // Essayer de parser directement
        try {
          data = JSON.parse(results);
        } catch {
          console.log('[check-linkedin-scan] Could not parse results as JSON');
          return { posts_found: 0, engagers_found: 0, contacts_enriched: 0 };
        }
      }
    }

    console.log(`[check-linkedin-scan] Processing ${data.posts?.length || 0} posts`);

    // Traiter chaque post
    for (const post of data.posts || []) {
      // Trouver la source correspondante
      const { data: source } = await supabase
        .from('linkedin_sources')
        .select('id')
        .eq('linkedin_url', post.source_url)
        .single();

      // Insérer le post
      const { data: savedPost, error: postError } = await supabase
        .from('linkedin_posts')
        .upsert({
          post_url: post.post_url,
          source_id: source?.id || null,
          title: post.post_content?.substring(0, 100) || 'Post LinkedIn',
          content: post.post_content,
          published_at: post.published_at,
          likes_count: post.likes_count || 0,
          comments_count: post.comments_count || 0,
          last_scraped_at: new Date().toISOString(),
        }, { onConflict: 'post_url' })
        .select()
        .single();

      if (postError) {
        console.error('[check-linkedin-scan] Error saving post:', postError);
        continue;
      }

      posts_found++;

      // Traiter les engagers de ce post
      for (const engager of post.engagers || []) {
        // Insérer l'engager
        const { data: savedEngager, error: engagerError } = await supabase
          .from('linkedin_engagers')
          .upsert({
            post_id: savedPost.id,
            name: engager.name,
            linkedin_url: engager.linkedin_url,
            headline: engager.headline,
            company: engager.company,
            engagement_type: engager.engagement_type || 'like',
            scraped_at: new Date().toISOString(),
            is_prospect: true, // Manus a déjà filtré les prospects intéressants
          }, { 
            onConflict: 'linkedin_url',
            ignoreDuplicates: false,
          })
          .select()
          .single();

        if (engagerError) {
          console.error('[check-linkedin-scan] Error saving engager:', engagerError);
          continue;
        }

        engagers_found++;

        // Si des données enrichies existent, créer un contact
        const enriched = engager.enriched_data;
        if (enriched && (enriched.email || enriched.phone)) {
          // Créer un signal placeholder pour le contact
          const { data: signal, error: signalError } = await supabase
            .from('signals')
            .insert({
              company_name: engager.company || 'LinkedIn Engager',
              signal_type: 'linkedin_engagement',
              event_detail: `Engagement sur LinkedIn: ${engager.engagement_type}`,
              score: 70,
              source_name: 'LinkedIn',
              source_url: engager.linkedin_url,
              status: 'new',
            })
            .select()
            .single();

          if (!signalError && signal) {
            // Créer le contact enrichi
            const nameParts = engager.name.split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            const { error: contactError } = await supabase
              .from('contacts')
              .insert({
                signal_id: signal.id,
                full_name: engager.name,
                first_name: firstName,
                last_name: lastName,
                email_principal: enriched.email,
                phone: enriched.phone,
                linkedin_url: engager.linkedin_url,
                job_title: enriched.current_position || engager.headline,
                location: enriched.location,
                source: 'linkedin_manus',
                notes: enriched.profile_summary,
                outreach_status: 'new',
              });

            if (!contactError) {
              contacts_enriched++;

              // Lier l'engager au contact
              await supabase
                .from('linkedin_engagers')
                .update({
                  transferred_to_contacts: true,
                  contact_id: signal.id, // Note: on utilise signal_id ici
                })
                .eq('id', savedEngager.id);
            }
          }
        }
      }
    }

    console.log(`[check-linkedin-scan] Processed: ${posts_found} posts, ${engagers_found} engagers, ${contacts_enriched} contacts`);

  } catch (error) {
    console.error('[check-linkedin-scan] Error processing results:', error);
  }

  return { posts_found, engagers_found, contacts_enriched };
}

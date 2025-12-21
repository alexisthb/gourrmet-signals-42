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
      method: 'GET',
      headers: {
        'API_KEY': MANUS_API_KEY.trim(),
        'Content-Type': 'application/json',
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
    if (isComplete && (manusTask.status === 'completed' || manusTask.status === 'done')) {
      console.log(`[check-linkedin-scan] Processing Manus results...`);
      
      const output = manusTask.output || manusTask.result || manusTask.data;
      
      // Extraire le fichier JSON si présent (format Manus avec messages)
      let jsonFileUrl: string | null = null;
      let parsedData: any = null;
      
      // Si output est un tableau de messages, chercher le fichier output_file
      if (Array.isArray(output)) {
        for (const message of output) {
          const content = Array.isArray(message?.content) ? message.content : [];
          for (const block of content) {
            const fileUrl = block?.fileUrl || block?.file_url;
            const mimeType = String(block?.mimeType || block?.mime_type || '');
            const fileName = String(block?.fileName || block?.file_name || '');
            
            if (block?.type === 'output_file' && fileUrl) {
              const isJson = mimeType.includes('json') || fileName.toLowerCase().endsWith('.json');
              if (isJson) {
                jsonFileUrl = String(fileUrl);
                console.log(`[check-linkedin-scan] Found JSON file: ${fileName}`);
              }
            }
          }
        }
      }
      
      // Télécharger le fichier JSON si trouvé
      if (jsonFileUrl) {
        console.log(`[check-linkedin-scan] Downloading JSON file...`);
        try {
          const fileResp = await fetch(jsonFileUrl);
          if (fileResp.ok) {
            parsedData = await fileResp.json();
            console.log(`[check-linkedin-scan] JSON file downloaded successfully`);
          } else {
            console.error(`[check-linkedin-scan] Failed to download JSON: ${fileResp.status}`);
          }
        } catch (e) {
          console.error(`[check-linkedin-scan] Error downloading JSON:`, e);
        }
      }
      
      // Si pas de fichier, essayer de parser le output directement
      if (!parsedData) {
        parsedData = output;
      }
      
      // Parser les résultats et insérer les données
      const processedData = await processManusResults(supabase, parsedData, scanRecord);

      await supabase
        .from('linkedin_scan_progress')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          posts_found: processedData.posts_found,
          engagers_found: processedData.engagers_found,
          contacts_enriched: processedData.contacts_enriched,
          results: output,
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
        // Vérifier si l'engager existe déjà (par linkedin_url ou nom+post)
        let existingEngager = null;
        if (engager.linkedin_url) {
          const { data } = await supabase
            .from('linkedin_engagers')
            .select('id')
            .eq('linkedin_url', engager.linkedin_url)
            .maybeSingle();
          existingEngager = data;
        }
        
        if (existingEngager) {
          console.log(`[check-linkedin-scan] Engager already exists: ${engager.name}`);
          engagers_found++;
          continue;
        }

        // Insérer le nouvel engager
        const { data: savedEngager, error: engagerError } = await supabase
          .from('linkedin_engagers')
          .insert({
            post_id: savedPost.id,
            name: engager.name,
            linkedin_url: engager.linkedin_url || null,
            headline: engager.headline || null,
            company: engager.company || null,
            engagement_type: engager.engagement_type || 'like',
            scraped_at: new Date().toISOString(),
            is_prospect: true,
          })
          .select()
          .single();

        if (engagerError) {
          console.error('[check-linkedin-scan] Error saving engager:', engagerError);
          continue;
        }

        engagers_found++;

        // Créer un signal pour chaque nouvel engager
        const engagementTypeLabel = engager.engagement_type === 'like' ? 'Like' : 
                                    engager.engagement_type === 'comment' ? 'Commentaire' : 
                                    engager.engagement_type === 'share' ? 'Partage' : 'Engagement';
        
        const { data: signal, error: signalError } = await supabase
          .from('signals')
          .insert({
            company_name: engager.company || 'Non spécifié',
            signal_type: 'linkedin_engagement',
            event_detail: `${engagementTypeLabel} sur LinkedIn`,
            score: engager.engagement_type === 'comment' ? 80 : engager.engagement_type === 'share' ? 75 : 70,
            source_name: 'LinkedIn',
            source_url: engager.linkedin_url || savedPost.post_url,
            status: 'new',
            sector: engager.headline || null,
          })
          .select()
          .single();

        if (signalError) {
          console.error('[check-linkedin-scan] Error creating signal:', signalError);
          continue;
        }

        // Créer le contact associé
        const nameParts = engager.name.split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '';
        const enriched = engager.enriched_data || {};

        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            signal_id: signal.id,
            full_name: engager.name,
            first_name: firstName,
            last_name: lastName,
            email_principal: enriched.email || null,
            phone: enriched.phone || null,
            linkedin_url: engager.linkedin_url || null,
            job_title: enriched.current_position || engager.headline || null,
            location: enriched.location || null,
            source: 'linkedin',
            notes: enriched.profile_summary || `${engagementTypeLabel} sur un post LinkedIn`,
            outreach_status: 'new',
          })
          .select()
          .single();

        if (contactError) {
          console.error('[check-linkedin-scan] Error creating contact:', contactError);
          continue;
        }

        contacts_enriched++;

        // Lier l'engager au contact
        await supabase
          .from('linkedin_engagers')
          .update({
            transferred_to_contacts: true,
            contact_id: contact.id,
          })
          .eq('id', savedEngager.id);

        console.log(`[check-linkedin-scan] Created signal & contact for: ${engager.name}`);
      }
    }

    console.log(`[check-linkedin-scan] Processed: ${posts_found} posts, ${engagers_found} engagers, ${contacts_enriched} contacts`);

  } catch (error) {
    console.error('[check-linkedin-scan] Error processing results:', error);
  }

  return { posts_found, engagers_found, contacts_enriched };
}

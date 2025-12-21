import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    console.log(`[transfer-engagers] Starting transfer of LinkedIn engagers to contacts`);

    // 1. Récupérer tous les engagers non transférés avec leur post
    const { data: engagers, error: engagersError } = await supabase
      .from('linkedin_engagers')
      .select(`
        *,
        linkedin_posts!inner (
          id,
          post_url,
          source_id,
          linkedin_sources (
            id,
            name
          )
        )
      `)
      .eq('transferred_to_contacts', false);

    if (engagersError) {
      console.error(`[transfer-engagers] Error fetching engagers:`, engagersError);
      throw engagersError;
    }

    console.log(`[transfer-engagers] Found ${engagers?.length || 0} engagers to transfer`);

    if (!engagers || engagers.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Aucun engager à transférer',
        transferred: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let transferredCount = 0;
    let signalsCreated = 0;
    let errorsCount = 0;

    for (const engager of engagers) {
      try {
        // Récupérer le nom de la source
        const sourceName = engager.linkedin_posts?.linkedin_sources?.name || 'LinkedIn';
        
        // Créer le signal de type linkedin_engagement
        const engagementTypeLabel = engager.engagement_type === 'comment' ? 'Commentaire' : 'Like';
        
        const { data: signal, error: signalError } = await supabase
          .from('signals')
          .insert({
            company_name: `Post ${sourceName}`,
            signal_type: 'linkedin_engagement',
            score: engager.engagement_type === 'comment' ? 75 : 50,
            status: 'new',
            enrichment_status: 'none',
            source_name: 'LinkedIn',
            source_url: engager.linkedin_url,
            event_detail: `${engagementTypeLabel} de ${engager.name}${engager.headline ? ` - ${engager.headline}` : ''}`,
            detected_at: engager.scraped_at || new Date().toISOString(),
          })
          .select()
          .single();

        if (signalError) {
          console.error(`[transfer-engagers] Error creating signal for ${engager.name}:`, signalError);
          errorsCount++;
          continue;
        }

        signalsCreated++;

        // Créer le contact lié au signal
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .insert({
            full_name: engager.name,
            linkedin_url: engager.linkedin_url,
            job_title: engager.headline,
            signal_id: signal.id,
            source: 'linkedin',
            outreach_status: 'new',
            notes: `Engagement: ${engagementTypeLabel} sur un post de ${sourceName}${engager.comment_text ? `\n\nCommentaire: ${engager.comment_text}` : ''}`,
          })
          .select()
          .single();

        if (contactError) {
          console.error(`[transfer-engagers] Error creating contact for ${engager.name}:`, contactError);
          errorsCount++;
          continue;
        }

        // Mettre à jour l'engager
        const { error: updateError } = await supabase
          .from('linkedin_engagers')
          .update({
            transferred_to_contacts: true,
            contact_id: contact.id,
          })
          .eq('id', engager.id);

        if (updateError) {
          console.error(`[transfer-engagers] Error updating engager ${engager.name}:`, updateError);
        }

        transferredCount++;
        console.log(`[transfer-engagers] Transferred: ${engager.name}`);

      } catch (err) {
        console.error(`[transfer-engagers] Error processing engager ${engager.name}:`, err);
        errorsCount++;
      }
    }

    console.log(`[transfer-engagers] Transfer complete: ${transferredCount} contacts, ${signalsCreated} signals, ${errorsCount} errors`);

    return new Response(JSON.stringify({
      success: true,
      message: `${transferredCount} engagers transférés vers les contacts`,
      transferred: transferredCount,
      signals_created: signalsCreated,
      errors: errorsCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[transfer-engagers] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

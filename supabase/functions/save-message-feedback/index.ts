import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SaveFeedbackRequest {
  message_type: 'inmail' | 'email';
  original_message: string;
  edited_message: string;
  original_subject?: string;
  edited_subject?: string;
  context?: {
    job_title?: string;
    company_name?: string;
    signal_type?: string;
    event_detail?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: SaveFeedbackRequest = await req.json();
    console.log('Saving message feedback:', {
      type: body.message_type,
      hasOriginal: !!body.original_message,
      hasEdited: !!body.edited_message,
      context: body.context
    });

    // Validate required fields
    if (!body.message_type || !body.original_message || !body.edited_message) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if learning is enabled
    const { data: charter } = await supabase
      .from('tonal_charter')
      .select('is_learning_enabled')
      .single();

    if (charter && !charter.is_learning_enabled) {
      console.log('Learning is disabled, skipping feedback save');
      return new Response(
        JSON.stringify({ success: false, reason: 'Learning disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Save the feedback
    const { data: feedback, error: insertError } = await supabase
      .from('message_feedback')
      .insert({
        message_type: body.message_type,
        original_message: body.original_message,
        edited_message: body.edited_message,
        original_subject: body.original_subject,
        edited_subject: body.edited_subject,
        context: body.context || {}
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error saving feedback:', insertError);
      throw insertError;
    }

    console.log('Feedback saved:', feedback.id);

    // Get total corrections count
    const { count } = await supabase
      .from('message_feedback')
      .select('*', { count: 'exact', head: true });

    // Update corrections count in tonal_charter
    await supabase
      .from('tonal_charter')
      .update({ corrections_count: count || 0 })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all rows (there's only one)

    // Check if we should trigger charter update (every 5 corrections)
    const shouldUpdateCharter = (count || 0) >= 5 && (count || 0) % 5 === 0;

    return new Response(
      JSON.stringify({
        success: true,
        feedback_id: feedback.id,
        total_corrections: count,
        should_update_charter: shouldUpdateCharter
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in save-message-feedback:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

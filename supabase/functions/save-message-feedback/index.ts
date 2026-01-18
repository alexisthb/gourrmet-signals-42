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

// Input validation helper
function validateInput(body: unknown): { valid: boolean; error?: string; data?: SaveFeedbackRequest } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const data = body as Record<string, unknown>;

  // Validate message_type
  if (!data.message_type || (data.message_type !== 'inmail' && data.message_type !== 'email')) {
    return { valid: false, error: 'message_type must be "inmail" or "email"' };
  }

  // Validate original_message
  if (!data.original_message || typeof data.original_message !== 'string' || data.original_message.length > 10000) {
    return { valid: false, error: 'original_message is required and must be under 10000 characters' };
  }

  // Validate edited_message
  if (!data.edited_message || typeof data.edited_message !== 'string' || data.edited_message.length > 10000) {
    return { valid: false, error: 'edited_message is required and must be under 10000 characters' };
  }

  // Validate optional fields
  if (data.original_subject && (typeof data.original_subject !== 'string' || data.original_subject.length > 500)) {
    return { valid: false, error: 'original_subject must be under 500 characters' };
  }

  if (data.edited_subject && (typeof data.edited_subject !== 'string' || data.edited_subject.length > 500)) {
    return { valid: false, error: 'edited_subject must be under 500 characters' };
  }

  // Validate context object
  if (data.context) {
    if (typeof data.context !== 'object') {
      return { valid: false, error: 'context must be an object' };
    }
    const ctx = data.context as Record<string, unknown>;
    if (ctx.job_title && (typeof ctx.job_title !== 'string' || ctx.job_title.length > 200)) {
      return { valid: false, error: 'context.job_title must be under 200 characters' };
    }
    if (ctx.company_name && (typeof ctx.company_name !== 'string' || ctx.company_name.length > 300)) {
      return { valid: false, error: 'context.company_name must be under 300 characters' };
    }
    if (ctx.signal_type && (typeof ctx.signal_type !== 'string' || ctx.signal_type.length > 100)) {
      return { valid: false, error: 'context.signal_type must be under 100 characters' };
    }
    if (ctx.event_detail && (typeof ctx.event_detail !== 'string' || ctx.event_detail.length > 1000)) {
      return { valid: false, error: 'context.event_detail must be under 1000 characters' };
    }
  }

  return {
    valid: true,
    data: {
      message_type: data.message_type as 'inmail' | 'email',
      original_message: String(data.original_message).trim(),
      edited_message: String(data.edited_message).trim(),
      original_subject: data.original_subject ? String(data.original_subject).trim() : undefined,
      edited_subject: data.edited_subject ? String(data.edited_subject).trim() : undefined,
      context: data.context as SaveFeedbackRequest['context'],
    }
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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

    // Create service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse and validate input
    const rawBody = await req.json();
    const validation = validateInput(rawBody);
    
    if (!validation.valid || !validation.data) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = validation.data;
    console.log('Saving message feedback:', {
      type: body.message_type,
      hasOriginal: !!body.original_message,
      hasEdited: !!body.edited_message,
    });

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

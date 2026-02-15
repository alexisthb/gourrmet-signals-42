import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { signalId } = await req.json();

    if (!signalId) {
      return new Response(JSON.stringify({ error: "signalId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get signal with logo_manus_task_id
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('id, company_name, logo_manus_task_id, company_logo_url')
      .eq('id', signalId)
      .single();

    if (signalError || !signal) {
      return new Response(JSON.stringify({ error: "Signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const taskId = signal.logo_manus_task_id;
    if (!taskId) {
      // No task running — maybe already completed
      return new Response(JSON.stringify({
        status: signal.company_logo_url ? "completed" : "no_task",
        logoUrl: signal.company_logo_url || null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check Manus task status
    const manusApiKey = Deno.env.get("MANUS_API_KEY");
    if (!manusApiKey) {
      return new Response(JSON.stringify({ error: "MANUS_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Logo Manus] Checking task ${taskId} for ${signal.company_name}`);

    const manusResponse = await fetch(`https://api.manus.ai/v1/tasks/${taskId}`, {
      method: "GET",
      headers: {
        "API_KEY": manusApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error(`[Logo Manus] API error: ${manusResponse.status} - ${errorText}`);
      return new Response(JSON.stringify({
        status: "processing",
        message: "Unable to check Manus status",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const taskData = await manusResponse.json();
    console.log(`[Logo Manus] Task status: ${taskData.status}`);

    // Still running
    if (taskData.status !== "completed") {
      return new Response(JSON.stringify({
        status: "processing",
        manus_status: taskData.status,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Task completed — find the image output
    console.log(`[Logo Manus] Task completed, extracting logo image...`);

    let imageUrl: string | null = null;
    const output = taskData.output;

    if (Array.isArray(output)) {
      // Manus output is array of messages with content blocks
      for (const message of output) {
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const block of content) {
          const fileUrl = block?.fileUrl || block?.file_url;
          const mimeType = String(block?.mimeType || block?.mime_type || "");
          const fileName = String(block?.fileName || block?.file_name || "");

          if (block?.type === "output_file" && fileUrl) {
            const isImage = mimeType.startsWith("image/") ||
              /\.(png|jpg|jpeg|svg|webp|gif)$/i.test(fileName);
            if (isImage) {
              imageUrl = String(fileUrl);
              console.log(`[Logo Manus] Found image: ${fileName} (${mimeType})`);
              break;
            }
          }
        }
        if (imageUrl) break;
      }
    }

    if (!imageUrl) {
      console.log("[Logo Manus] No image found in Manus output");
      // Clear task ID since it's done but no image found
      await supabase.from('signals').update({ logo_manus_task_id: null }).eq('id', signalId);
      return new Response(JSON.stringify({
        status: "completed",
        logoUrl: null,
        message: "Manus completed but no logo image found in output",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download the image from Manus output
    console.log(`[Logo Manus] Downloading image from ${imageUrl}`);
    const imageResp = await fetch(imageUrl);
    if (!imageResp.ok) {
      console.error(`[Logo Manus] Failed to download image: ${imageResp.status}`);
      await supabase.from('signals').update({ logo_manus_task_id: null }).eq('id', signalId);
      return new Response(JSON.stringify({
        status: "completed",
        logoUrl: null,
        message: "Failed to download logo image from Manus",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imageBuffer = await imageResp.arrayBuffer();
    const contentType = imageResp.headers.get('content-type') || 'image/png';

    // Determine file extension
    let ext = 'png';
    if (contentType.includes('svg')) ext = 'svg';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('webp')) ext = 'webp';

    // Upload to company-logos bucket
    const fileName = `${signalId}_manus_${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(fileName, imageBuffer, { contentType, upsert: true });

    if (uploadError) {
      console.error(`[Logo Manus] Upload error: ${uploadError.message}`);
      await supabase.from('signals').update({ logo_manus_task_id: null }).eq('id', signalId);
      return new Response(JSON.stringify({
        status: "completed",
        logoUrl: null,
        message: `Upload failed: ${uploadError.message}`,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: publicUrlData } = supabase.storage.from('company-logos').getPublicUrl(fileName);
    const logoUrl = publicUrlData.publicUrl;

    // Update signal: set logo URL and clear task ID
    await supabase.from('signals').update({
      company_logo_url: logoUrl,
      logo_manus_task_id: null,
    }).eq('id', signalId);

    console.log(`[Logo Manus] ✓ Logo saved for ${signal.company_name}: ${logoUrl}`);

    return new Response(JSON.stringify({
      status: "completed",
      logoUrl,
      source: "manus",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[Logo Manus] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

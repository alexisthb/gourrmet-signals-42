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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  let giftId: string | null = null;

  try {
    const { signalId, templateId, customPrompt } = await req.json();

    if (!signalId || !templateId) {
      return new Response(JSON.stringify({ error: "signalId and templateId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Fetch signal data
    const { data: signal, error: signalError } = await supabase
      .from('signals')
      .select('company_name, company_logo_url')
      .eq('id', signalId)
      .single();

    if (signalError || !signal) throw new Error("Signal not found");
    if (!signal.company_logo_url) throw new Error("Company logo not available. Please fetch the logo first.");

    // Fetch template data
    const { data: template, error: templateError } = await supabase
      .from('gift_templates')
      .select('name, image_url')
      .eq('id', templateId)
      .single();

    if (templateError || !template) throw new Error("Template not found");
    if (!template.image_url) throw new Error("Template image not available");

    // Create generated_gifts record with status processing
    const promptText = customPrompt || `Using the provided base image as the main background reference and the provided PNG logo as the replacement asset, remove the existing logo entirely and replace it with the new PNG logo.

The new logo must match the exact placement, scale, alignment, and perspective of the original logo.

Integrate it seamlessly into the environment with realistic lighting interaction, accurate shadow casting, surface texture adaptation, and subtle depth blending.

If the logo is applied on a textured or reflective surface, adapt the logo to the material properties (matte, glossy, metallic, embossed, printed, engraved, fabric, etc.).

Preserve the original image composition, framing, lighting direction, color grading, and overall realism.

Ensure natural integration with correct highlights, micro-shadows, slight surface distortion if needed, and realistic environmental reflections when applicable.

The result must look physically embedded in the scene. Not pasted or flat. Ultra-realistic, high fidelity, seamless brand integration.`;

    const { data: giftRecord, error: insertError } = await supabase
      .from('generated_gifts')
      .insert({
        signal_id: signalId,
        template_id: templateId,
        company_name: signal.company_name,
        company_logo_url: signal.company_logo_url,
        original_image_url: template.image_url,
        prompt_used: promptText,
        status: 'processing',
      })
      .select('id')
      .single();

    if (insertError) throw new Error(`Failed to create gift record: ${insertError.message}`);
    giftId = giftRecord.id;

    console.log(`Generating gift image for ${signal.company_name} with template ${template.name}`);

    // Call Lovable AI Gateway with image editing (multi-modal)
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: template.image_url } },
              { type: "image_url", image_url: { url: signal.company_logo_url } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        await supabase.from('generated_gifts').update({ status: 'failed', error_message: 'Rate limit exceeded' }).eq('id', giftId);
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        await supabase.from('generated_gifts').update({ status: 'failed', error_message: 'Payment required' }).eq('id', giftId);
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const generatedImageBase64 = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!generatedImageBase64) {
      throw new Error("No image generated by AI");
    }

    // Convert base64 to binary and upload to storage
    const base64Data = generatedImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

    const fileName = `${signalId}_${templateId}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('generated-gifts')
      .upload(fileName, binaryData, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage
      .from('generated-gifts')
      .getPublicUrl(fileName);

    const generatedImageUrl = publicUrlData.publicUrl;

    // Update gift record
    await supabase.from('generated_gifts').update({
      status: 'completed',
      generated_image_url: generatedImageUrl,
    }).eq('id', giftId);

    console.log(`Gift image generated successfully: ${generatedImageUrl}`);

    return new Response(
      JSON.stringify({ generatedImageUrl, giftId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating gift image:", error);

    // Update gift record with error if we have one
    if (giftId) {
      await supabase.from('generated_gifts').update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
      }).eq('id', giftId);
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

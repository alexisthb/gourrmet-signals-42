import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function processGiftGeneration(
  supabase: any,
  giftId: string,
  signalId: string,
  signal: { company_name: string; company_logo_url: string },
  template: { name: string; image_url: string; custom_prompt: string | null },
  promptText: string
) {
  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

    // Helper: fetch image and convert to base64 data URL
    async function toDataUrl(url: string): Promise<string> {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch image: ${url} (${res.status})`);
      const contentType = res.headers.get("content-type") || "image/png";
      if (contentType.includes("svg")) throw new Error("SVG_LOGO");
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = "";
      for (let i = 0; i < bytes.length; i++) {
        b64 += String.fromCharCode(bytes[i]);
      }
      return `data:${contentType};base64,${btoa(b64)}`;
    }

    // Try to get logo as base64; if SVG, find a PNG alternative
    let logoDataUrl: string;
    try {
      logoDataUrl = await toDataUrl(signal.company_logo_url);
    } catch (e) {
      if (e instanceof Error && e.message === "SVG_LOGO") {
        console.log("Logo is SVG, finding PNG replacement...");
        const domain = signal.company_name.toLowerCase().replace(/[^a-z0-9]/g, '') + ".com";
        const fallbacks = [
          `https://logo.clearbit.com/${domain}`,
          `https://www.google.com/s2/favicons?domain=${domain}&sz=256`,
        ];
        let found = false;
        for (const fallbackUrl of fallbacks) {
          try {
            const fbRes = await fetch(fallbackUrl);
            if (fbRes.ok) {
              const fbType = fbRes.headers.get("content-type") || "image/png";
              if (!fbType.includes("svg")) {
                const fbBuf = await fbRes.arrayBuffer();
                const fbBytes = new Uint8Array(fbBuf);
                const logoFileName = `${signalId}_${Date.now()}.png`;
                await supabase.storage.from('company-logos').upload(logoFileName, fbBytes, { contentType: 'image/png', upsert: true });
                const { data: publicUrlData } = supabase.storage.from('company-logos').getPublicUrl(logoFileName);
                const newLogoUrl = publicUrlData.publicUrl;
                const oldParts = signal.company_logo_url.split('/company-logos/');
                if (oldParts.length > 1) {
                  await supabase.storage.from('company-logos').remove([oldParts[1]]);
                }
                await supabase.from('signals').update({ company_logo_url: newLogoUrl }).eq('id', signalId);
                await supabase.from('generated_gifts').update({ company_logo_url: newLogoUrl }).eq('id', giftId);
                let fbB64 = "";
                for (let i = 0; i < fbBytes.length; i++) {
                  fbB64 += String.fromCharCode(fbBytes[i]);
                }
                logoDataUrl = `data:${fbType};base64,${btoa(fbB64)}`;
                found = true;
                break;
              }
            }
          } catch (err) {
            console.log(`Fallback failed: ${fallbackUrl}`, err);
          }
        }
        if (!found) {
          throw new Error("Le logo est au format SVG et aucune alternative PNG n'a été trouvée.");
        }
      } else {
        throw e;
      }
    }

    const templateDataUrl = await toDataUrl(template.image_url);

    console.log(`Generating gift image for ${signal.company_name} with template ${template.name}`);

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
              { type: "image_url", image_url: { url: templateDataUrl } },
              { type: "image_url", image_url: { url: logoDataUrl } },
            ],
          },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      const errorMsg = response.status === 429 ? 'Rate limit exceeded' 
        : response.status === 402 ? 'Payment required' 
        : `AI gateway error: ${response.status}`;
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: errorMsg }).eq('id', giftId);
      return;
    }

    const data = await response.json();
    const generatedImageBase64 = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

    if (!generatedImageBase64) {
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: 'No image generated by AI' }).eq('id', giftId);
      return;
    }

    // Upload to storage
    const base64Data = generatedImageBase64.replace(/^data:image\/\w+;base64,/, '');
    const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    const fileName = `${signalId}_${giftId}_${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from('generated-gifts')
      .upload(fileName, binaryData, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: `Upload failed: ${uploadError.message}` }).eq('id', giftId);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('generated-gifts').getPublicUrl(fileName);
    const generatedImageUrl = publicUrlData.publicUrl;

    await supabase.from('generated_gifts').update({
      status: 'completed',
      generated_image_url: generatedImageUrl,
    }).eq('id', giftId);

    console.log(`Gift image generated successfully: ${generatedImageUrl}`);
  } catch (error) {
    console.error("Error in background generation:", error);
    await supabase.from('generated_gifts').update({
      status: 'failed',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    }).eq('id', giftId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

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
      .select('name, image_url, custom_prompt')
      .eq('id', templateId)
      .single();

    if (templateError || !template) throw new Error("Template not found");
    if (!template.image_url) throw new Error("Template image not available");

    // Build prompt
    const defaultPrompt = `Using the provided base image as the main background reference and the provided PNG logo as the replacement asset:

1. LOGO PLACEMENT: Remove any existing logo or branding from the original image and replace it with the provided PNG logo. The logo must be naturally integrated, matching the exact placement, scale, alignment, and perspective of the surface.

2. COMPANY NAME TEXT: Add the text "${signal.company_name}" elegantly on the product. The text should be in a refined, luxury serif font, properly adapted to the surface curvature, with realistic embossing or printing effect.

3. INTEGRATION RULES:
- Integrate seamlessly with realistic lighting interaction, accurate shadow casting, surface texture adaptation, and subtle depth blending
- Adapt to the material properties (matte, glossy, wax, glass, fabric, etc.)
- Preserve the original image composition, framing, lighting direction, color grading, and overall realism

The result must look physically embedded in the scene. Not pasted or flat. Ultra-realistic, high fidelity, seamless brand integration.`;

    const templateInstructions = template.custom_prompt
      ? template.custom_prompt.replace(/\{\{company_name\}\}/g, signal.company_name)
      : null;

    const promptText = customPrompt || (templateInstructions
      ? `${defaultPrompt}\n\n## ADDITIONAL INSTRUCTIONS FOR THIS SPECIFIC PRODUCT:\n${templateInstructions}`
      : defaultPrompt);

    // Create gift record immediately
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

    // Fire and forget: launch generation in background
    // Using EdgeRuntime.waitUntil to keep the function alive after responding
    const backgroundPromise = processGiftGeneration(
      supabase, giftRecord.id, signalId, signal, template, promptText
    );

    // Try waitUntil if available (Deno Deploy / Supabase Edge Runtime)
    try {
      // @ts-ignore - waitUntil may not be typed
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(backgroundPromise);
      } else {
        // Fallback: just let it run (connection may close but the promise continues)
        backgroundPromise.catch(err => console.error("Background generation error:", err));
      }
    } catch {
      backgroundPromise.catch(err => console.error("Background generation error:", err));
    }

    // Return immediately with the gift ID
    return new Response(
      JSON.stringify({ giftId: giftRecord.id, status: 'processing' }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

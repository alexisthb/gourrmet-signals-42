import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // ------------------------------------------------------------
    // Modeles Gemini Image : seuls modeles compatibles avec
    // /v1/chat/completions + images de reference (template + logo)
    // necessaires pour faire de l'edition. openai/gpt-image-2 vit
    // sur /v1/images/generations et n'accepte PAS d'images d'entree
    // -> renvoyait 400 systematiquement.
    // Primaire = Gemini 3 Pro Image (meilleure qualite + meilleure
    // obeissance aux contraintes negatives chocolat).
    // Fallback = Gemini 3.1 Flash Image (plus rapide / moins cher).
    // ------------------------------------------------------------
    const PRIMARY_MODEL = "google/gemini-3-pro-image-preview";
    const FALLBACK_MODEL = "google/gemini-3.1-flash-image-preview";

    async function callImageModel(modelId: string): Promise<Response> {
      return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
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
    }

    const isTransientFailure = (status: number) =>
      status === 429 || status === 402 || status === 503 || (status >= 500 && status < 600);

    let modelUsed = PRIMARY_MODEL;
    let response = await callImageModel(PRIMARY_MODEL);

    if (!response.ok && isTransientFailure(response.status)) {
      const primaryStatus = response.status;
      const primaryBody = await response.text().catch(() => "");
      console.warn(`[generate-gift-image] PRIMARY ${PRIMARY_MODEL} returned ${primaryStatus}, falling back to ${FALLBACK_MODEL}. Body: ${primaryBody.slice(0, 200)}`);
      modelUsed = FALLBACK_MODEL;
      response = await callImageModel(FALLBACK_MODEL);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`AI gateway error (${modelUsed}):`, response.status, errorText);
      const errorMsg = response.status === 429 ? 'Rate limit exceeded'
        : response.status === 402 ? 'Payment required'
        : `AI gateway error: ${response.status}`;
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: errorMsg }).eq('id', giftId);
      return;
    }

    console.log(`[generate-gift-image] Generated successfully via ${modelUsed}`);

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

    // ------------------------------------------------------------
    // Detection chocolat : on cherche dans le nom du template ET dans
    // le custom_prompt (saisi par Clotilde). Clotilde s'est plainte 3x
    // que les visuels chocolat sortent avec un chocolat colore aux
    // couleurs du logo, ce qui n'est pas physiquement realisable.
    // ------------------------------------------------------------
    const normalize = (s: string | null | undefined) =>
      (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const chocolateKeywords = [
      'chocolat', 'chocolate', 'tablette', 'praline', 'praliné',
      'truffe', 'truffle', 'bonbon', 'ganache', 'cacao', 'cocoa',
      'moulage', 'moule', 'molded', 'fritsch', 'pastille',
    ];
    const haystack = `${normalize(template.name)} ${normalize(template.custom_prompt)}`;
    const isChocolate = chocolateKeywords.some((kw) => haystack.includes(kw));

    const templateInstructions = template.custom_prompt
      ? template.custom_prompt.replace(/\{\{company_name\}\}/g, signal.company_name)
      : null;

    // ------------------------------------------------------------
    // Prompt chocolat : REGLE D'OR METIER (Gourrmet / chocolatier) :
    //   sur le chocolat, le BLANC est le seul colorant autorise.
    //   Le logo doit donc etre reproduit en BLANC MONOCHROME (impression
    //   edible blanche / marquage chocolat blanc), JAMAIS aux couleurs
    //   de la marque. Les versions precedentes (PR #9/#10) disaient au
    //   modele de garder le logo en couleurs (sticker full-color) -> c'est
    //   exactement ce que Clotilde refuse car physiquement impossible sur
    //   du chocolat. On inverse la consigne : logo 100% blanc.
    // Contraintes au DEBUT, court (<350 mots), vocabulaire visuel precis.
    // ------------------------------------------------------------
    const chocolatePrompt = `You will edit the provided base image. The base image shows real edible chocolate. Output ONE photorealistic image.

GOLDEN RULE — NON-NEGOTIABLE, overrides every other instruction:
On chocolate, the ONLY colorant that may ever appear is PURE WHITE. No other color is physically possible on chocolate — not the brand colors, not gold, not black, nothing but white.

WHAT YOU MUST DO:
Reproduce the shape, letters and layout of the provided PNG logo on the chocolate as a SOLID PURE-WHITE marking — like a white food-grade edible-ink screen print or a fine white-chocolate inlay applied flat on the surface. Keep the logo's exact silhouette, proportions, letterforms and relative placement, but render the ENTIRE logo in one uniform clean white. The white logo sits flat on the chocolate and catches only soft realistic lighting. Match the position, scale and perspective of any existing logo/printed area on the base image; if a logo already exists there, replace it with this white version of the provided PNG.

ABSOLUTE COLOR RULES:
- The chocolate body MUST stay its natural cocoa color (dark brown, milk brown, or ivory). Never tint, dye, paint, glaze, airbrush or recolor the chocolate itself.
- The logo on the chocolate MUST be pure white only. DISCARD the logo's original brand colors entirely — do NOT reproduce any red, blue, green, orange, gold, black, gradient or hue from the PNG. Use the PNG only as a shape reference; the output marking is white.
- No brand color may touch the chocolate anywhere in the image.

FORBIDDEN:
- reproducing the logo in its brand colors (or any non-white color) on the chocolate
- coloring or tinting the chocolate itself with any brand color
- gold, metallic, black or colored ink for the logo
- multi-color or gradient logo on chocolate
- deep engraving/debossing that distorts or hollows the logo silhouette — keep it a clean flat white print
- adding a separate brown chocolate-embossed version of "${signal.company_name}"

WHAT TO PRESERVE: composition, framing, background, lighting direction and intensity, camera angle, chocolate texture (sheen, cocoa highlights, bloom, glossiness), shadows, depth of field. Only the logo-marking area changes — and it is white.

${templateInstructions ? `ADDITIONAL POSITIONING NOTES (refine WHERE/HOW the white logo is placed; they never override the white-only rule above):\n${templateInstructions}\n\n` : ''}Final check before output: the chocolate is natural brown/ivory; the logo is rendered in PURE WHITE only; there is ZERO brand color anywhere on the chocolate. If any check fails, redo the logo in white — never use brand colors on chocolate.`;

    // ------------------------------------------------------------
    // Prompt non-chocolat : conserve le comportement actuel pour les
    // bougies, rubans, coffrets, etc. Les contraintes "ABSOLUTE" finales
    // sont gardees mais avec un wording plus court : Gemini Image
    // gere mieux qu'avec le bloc precedent de ~200 lignes.
    // ------------------------------------------------------------
    const standardPrompt = `Using the provided base image as the main background reference and the provided PNG logo as the only brand asset:

1. LOGO PLACEMENT: Remove any existing logo or branding from the original image and replace it with the provided PNG logo. The logo must be naturally integrated, matching the exact placement, scale, alignment, and perspective of the surface.

2. COMPANY NAME / WORDMARK: Do NOT create a separate engraved, carved, debossed, or tone-on-tone version of "${signal.company_name}". If the company name appears in the provided PNG logo, preserve that wordmark exactly from the PNG, in its original colors. If the provided PNG logo does not contain the company name, do not add the company name unless explicitly requested.

3. LOGO COLOR INTEGRITY: The provided PNG logo MUST be reproduced with its ORIGINAL FULL-COLOR palette, exactly as in the input. Never tint, recolor, hue-shift, monochrome, or desaturate the logo, its wordmark, or any of its elements. Apply it as a flat printed label / sticker / screen-print, allowing only realistic lighting and shadow on top.

4. INTEGRATION RULES:
- Integrate seamlessly with realistic lighting, accurate shadows, surface texture adaptation, and subtle depth blending
- Adapt to the material properties (matte, glossy, wax, glass, fabric, etc.) without changing the logo colors
- Preserve the original image composition, framing, lighting direction, color grading, and overall realism

${templateInstructions ? `ADDITIONAL INSTRUCTIONS FOR THIS SPECIFIC PRODUCT:\n${templateInstructions}\n\n` : ''}The result must look physically embedded in the scene, not pasted or flat. Ultra-realistic, high fidelity, seamless brand integration — but the logo colors stay as in the input PNG.`;

    // Si l'utilisateur a fourni un customPrompt direct en arg (override
    // explicite cote front), on l'utilise tel quel (cas edge, ex. debug).
    // Sinon on selectionne automatiquement chocolat vs standard.
    const promptText = customPrompt || (isChocolate ? chocolatePrompt : standardPrompt);

    if (isChocolate) {
      console.log(`[generate-gift-image] Template "${template.name}" detected as CHOCOLATE -> using chocolate-specific prompt`);
    }

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

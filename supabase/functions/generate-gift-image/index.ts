import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildLogoDomainCandidates } from "../_shared/company-website.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { detectChocolateTemplate } from "../_shared/gift-chocolate.ts";
import {
  buildColorCheckPrompt,
  buildColorRegenerationFeedback,
  parseColorCheckVerdict,
  type ColorCheckVerdict,
} from "../_shared/chocolate-color-check.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertLovableAILedgerReady,
  callMeteredLovableAI,
  markLovableAIAttemptFailed,
} from "../_shared/lovable-ai-usage.ts";

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
        // Ce repli cumulait les trois défauts corrigés dans fetch-company-logo
        // le 2026-08-21/22, et pour les mêmes raisons :
        //   - Clearbit en tête, alors que `logo.clearbit.com` ne résout plus ;
        //   - aucune variante `www.`, alors que beaucoup de sites d'entreprise
        //     ne répondent QUE sur le sous-domaine ;
        //   - les accents SUPPRIMÉS au lieu d'être translittérés — « Crédit
        //     Agricole » donnait `crditagricole.com`, une adresse inexistante.
        // La construction des candidats vit désormais dans `_shared`, où elle
        // est testée sur des chaînes réelles relevées en base.
        const racine = signal.company_name
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toLowerCase().replace(/[^a-z0-9]/g, '');
        const fallbacks = racine
          ? buildLogoDomainCandidates(`${racine}.com`).flatMap((d) => [
              `https://${d}/apple-touch-icon.png`,
              `https://www.google.com/s2/favicons?domain=${d}&sz=256`,
            ])
          : [];
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
    const invocationId = crypto.randomUUID();

    await assertLovableAILedgerReady(supabase);

    async function callImageModel(
      modelId: string,
      attempt: number,
      promptOverride?: string,
    ) {
      return callMeteredLovableAI({
        supabase,
        apiKey: LOVABLE_API_KEY,
        operation: "generate_gift_image",
        invocationId,
        attempt,
        model: modelId,
        itemsCount: 1,
        itemBasis: "image_requested",
        signalId,
        runId: giftId,
        body: {
          model: modelId,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: promptOverride ?? promptText },
                { type: "image_url", image_url: { url: templateDataUrl } },
                { type: "image_url", image_url: { url: logoDataUrl } },
              ],
            },
          ],
          modalities: ["image", "text"],
        },
      });
    }

    // L'image générée arrive en data-URL dans message.images[0].image_url.url.
    function extractGeneratedImage(payload: Record<string, unknown> | null): string {
      const choices = Array.isArray(payload?.choices) ? payload.choices : [];
      const choice = choices[0] && typeof choices[0] === "object"
        ? choices[0] as Record<string, unknown>
        : null;
      const msg = choice?.message && typeof choice.message === "object"
        ? choice.message as Record<string, unknown>
        : null;
      const imgs = Array.isArray(msg?.images) ? msg.images : [];
      const img = imgs[0] && typeof imgs[0] === "object"
        ? imgs[0] as Record<string, unknown>
        : null;
      const url = img?.image_url && typeof img.image_url === "object"
        ? img.image_url as Record<string, unknown>
        : null;
      return typeof url?.url === "string" ? url.url : "";
    }

    // LA RÈGLE D'OR SE VÉRIFIE, ELLE NE SE DEMANDE PAS. Un modèle de vision
    // examine l'image générée ; verdict structuré, « unreadable » n'est
    // JAMAIS un laissez-passer. En cas de panne du vérificateur : fail-open
    // en « unverified » — la vérification informe, elle ne bloque pas la
    // livraison d'une image que l'opératrice peut juger elle-même.
    const VERIFIER_MODEL = "google/gemini-3-flash-preview";
    async function checkChocolateColors(
      imageDataUrl: string,
      attempt: number,
      verifInvocationId: string,
    ): Promise<ColorCheckVerdict | { verdict: "unverified"; coloredElements: string[] }> {
      try {
        const check = await callMeteredLovableAI({
          supabase,
          apiKey: LOVABLE_API_KEY,
          operation: "verify_gift_image_colors",
          invocationId: verifInvocationId,
          attempt,
          model: VERIFIER_MODEL,
          itemsCount: 1,
          itemBasis: "image_requested",
          signalId,
          runId: giftId,
          body: {
            model: VERIFIER_MODEL,
            max_tokens: 512,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: buildColorCheckPrompt() },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
          },
        });
        if (!check.ok || !check.payload) {
          console.warn(`[color-check] verifier unavailable (${check.status})`);
          return { verdict: "unverified", coloredElements: [] };
        }
        const choices = Array.isArray(check.payload.choices) ? check.payload.choices : [];
        const msg = choices[0] && typeof choices[0] === "object"
          ? (choices[0] as Record<string, unknown>).message as Record<string, unknown> | null
          : null;
        const text = typeof msg?.content === "string" ? msg.content : "";
        return parseColorCheckVerdict(text);
      } catch (error) {
        console.warn("[color-check] verifier crashed", error);
        return { verdict: "unverified", coloredElements: [] };
      }
    }

    const isTransientFailure = (status: number) =>
      status === 429 || status === 402 || status === 503 || (status >= 500 && status < 600);

    let modelUsed = PRIMARY_MODEL;
    let aiCall = await callImageModel(PRIMARY_MODEL, 1);

    if (!aiCall.ok && isTransientFailure(aiCall.status)) {
      const primaryStatus = aiCall.status;
      const primaryBody = aiCall.rawBody;
      console.warn(`[generate-gift-image] PRIMARY ${PRIMARY_MODEL} returned ${primaryStatus}, falling back to ${FALLBACK_MODEL}. Body: ${primaryBody.slice(0, 200)}`);
      modelUsed = FALLBACK_MODEL;
      aiCall = await callImageModel(FALLBACK_MODEL, 2);
    }

    if (!aiCall.ok) {
      console.error(`AI gateway error (${modelUsed}):`, aiCall.status, aiCall.rawBody);
      const errorMsg = aiCall.status === 429 ? 'Rate limit exceeded'
        : aiCall.status === 402 ? 'Payment required'
        : `AI gateway error: ${aiCall.status}`;
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: errorMsg }).eq('id', giftId);
      return;
    }

    console.log(`[generate-gift-image] Generated successfully via ${modelUsed}`);

    if (!aiCall.payload) {
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: 'AI gateway returned invalid JSON' }).eq('id', giftId);
      return;
    }
    let generatedImageBase64 = extractGeneratedImage(aiCall.payload);

    if (!generatedImageBase64) {
      await markLovableAIAttemptFailed(supabase, aiCall.requestKey, "empty_image");
      await supabase.from('generated_gifts').update({ status: 'failed', error_message: 'No image generated by AI' }).eq('id', giftId);
      return;
    }

    // ── Vérification de la règle d'or, pour les gabarits CHOCOLAT seulement ──
    // (sur une bougie ou un coffret, les couleurs de marque sont légitimes).
    // Non conforme → UNE régénération qui nomme les éléments fautifs → nouveau
    // verdict. La meilleure image part, son verdict est PERSISTÉ.
    let colorCheck: { verdict: string; coloredElements: string[] } = {
      verdict: "not_applicable",
      coloredElements: [],
    };
    const chocolateCheckNeeded = detectChocolateTemplate(
      template.name,
      template.custom_prompt,
    ).isChocolate;

    if (chocolateCheckNeeded) {
      const verifInvocationId = crypto.randomUUID();
      colorCheck = await checkChocolateColors(generatedImageBase64, 1, verifInvocationId);
      console.log(`[color-check] first image: ${colorCheck.verdict}`, colorCheck.coloredElements);

      if (colorCheck.verdict === "failed") {
        const regenPrompt = `${promptText}\n\n${buildColorRegenerationFeedback(colorCheck.coloredElements)}`;
        const retryCall = await callImageModel(modelUsed, 3, regenPrompt);
        if (retryCall.ok && retryCall.payload) {
          const retryImage = extractGeneratedImage(retryCall.payload);
          if (retryImage) {
            const retryVerdict = await checkChocolateColors(retryImage, 2, verifInvocationId);
            console.log(`[color-check] regenerated image: ${retryVerdict.verdict}`, retryVerdict.coloredElements);
            // La régénération gagne si elle fait STRICTEMENT mieux : conforme,
            // ou moins d'éléments fautifs. À égalité, la première reste.
            const better = retryVerdict.verdict === "passed" ||
              (retryVerdict.verdict === "failed" &&
                retryVerdict.coloredElements.length < colorCheck.coloredElements.length);
            if (better) {
              generatedImageBase64 = retryImage;
              colorCheck = retryVerdict;
            }
          } else {
            await markLovableAIAttemptFailed(supabase, retryCall.requestKey, "empty_image");
          }
        }
      }
    }

    // ── FAIL-CLOSED sur la règle d'or ──
    // Une image chocolat encore fautive APRÈS la régénération n'est PAS
    // livrée : infabricable en alimentaire, elle est commercialement
    // inutilisable, et la livrer « avec un avertissement » revient à la
    // laisser partir chez un prospect (constaté le 2026-08-22 au soir :
    // l'opérateur a vu le drapeau bleu/rouge, pas le verdict). L'image
    // fautive est tout de même archivée pour l'inspection, mais le statut
    // est un échec franc, avec la liste des éléments colorés — un nouveau
    // clic relance une génération, chacune a sa chance.
    // « unverified » (vérificateur en panne) et « unreadable » (réponse
    // illisible) ne bloquent pas : sans preuve de faute, on livre et on le
    // dit — bloquer sur une panne du vérificateur arrêterait tous les
    // visuels chocolat pour un caprice de format.
    const failClosed = chocolateCheckNeeded && colorCheck.verdict === "failed";

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

    const colorCheckRecord = {
      verdict: colorCheck.verdict,
      elements_colores: colorCheck.coloredElements,
      verified_at: new Date().toISOString(),
    };

    if (failClosed) {
      await supabase.from('generated_gifts').update({
        status: 'failed',
        // L'image reste archivée (inspection), mais le statut est un échec
        // franc : rien de coloré ne part chez un prospect.
        generated_image_url: generatedImageUrl,
        color_check: colorCheckRecord,
        error_message:
          'Marquage non conforme à la règle d\'or (blanc uniquement sur chocolat) : ' +
          colorCheck.coloredElements.join(' ; ') +
          '. Relancez la génération — chaque tentative est vérifiée.',
      }).eq('id', giftId);
      console.log(`Gift image REFUSED by color check: ${generatedImageUrl}`, colorCheck.coloredElements);
      return;
    }

    await supabase.from('generated_gifts').update({
      status: 'completed',
      generated_image_url: generatedImageUrl,
      color_check: colorCheckRecord,
    }).eq('id', giftId);

    console.log(`Gift image generated successfully: ${generatedImageUrl} (color check: ${colorCheck.verdict})`);
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

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

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
    const chocolateDetection = detectChocolateTemplate(
      template.name,
      template.custom_prompt,
    );
    const isChocolate = chocolateDetection.isChocolate;

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
- EVERY sub-element of the logo becomes white too: icons, symbols, flags, underline bars, dots, accents, taglines, decorative marks. A French flag inside the logo becomes two WHITE bars — never blue and red. A colored dot becomes a WHITE dot. If a sub-element only makes sense in color, OMIT it rather than color it. (Observed failure 2026-08-22: the monogram came out white but the flag bars below it stayed blue and red.)
- No brand color may touch the chocolate anywhere in the image.
- Never ADD any text, watermark, signature or AI label anywhere in the image; if the base image carries a faint watermark, remove it.

FORBIDDEN:
- reproducing the logo in its brand colors (or any non-white color) on the chocolate
- coloring or tinting the chocolate itself with any brand color
- gold, metallic, black or colored ink for the logo
- multi-color or gradient logo on chocolate
- deep engraving/debossing that distorts or hollows the logo silhouette — keep it a clean flat white print
- adding a separate brown chocolate-embossed version of "${signal.company_name}"

WHAT TO PRESERVE: composition, framing, background, lighting direction and intensity, camera angle, chocolate texture (sheen, cocoa highlights, bloom, glossiness), shadows, depth of field. Only the logo-marking area changes — and it is white.

${templateInstructions ? `ADDITIONAL POSITIONING NOTES (refine WHERE/HOW the white logo is placed; they never override the white-only rule above):\n${templateInstructions}\n\n` : ''}Final check before output: the chocolate is natural brown/ivory; the logo AND every one of its sub-elements (flags, bars, dots, symbols) are rendered in PURE WHITE only; there is ZERO brand color anywhere on the chocolate; there is NO watermark or added text anywhere. If any check fails, redo the logo in white — never use brand colors on chocolate.`;

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
      console.log(
        `[generate-gift-image] Template "${template.name}" detected as CHOCOLATE ` +
          `(via ${chocolateDetection.matchedBy}: "${chocolateDetection.matchedTerm}") ` +
          `-> using chocolate-specific prompt`,
      );
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

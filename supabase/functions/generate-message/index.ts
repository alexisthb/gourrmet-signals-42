import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertLovableAILedgerReady,
  callMeteredLovableAI,
  markLovableAIAttemptFailed,
} from "../_shared/lovable-ai-usage.ts";

const AI_MODEL = "google/gemini-3-flash-preview";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GenerateMessageRequest {
  type: "inmail" | "email";
  recipientName: string;
  recipientFirstName: string;
  companyName?: string;
  eventDetail?: string;
  jobTitle?: string;
  signalId?: string;
  contactId?: string;
}

// Input validation helper
function validateInput(body: unknown): { valid: boolean; error?: string; data?: GenerateMessageRequest } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  const data = body as Record<string, unknown>;

  // Validate type
  if (!data.type || (data.type !== 'inmail' && data.type !== 'email')) {
    return { valid: false, error: 'type must be "inmail" or "email"' };
  }

  // Validate recipientName
  if (!data.recipientName || typeof data.recipientName !== 'string' || data.recipientName.length > 200) {
    return { valid: false, error: 'recipientName is required and must be under 200 characters' };
  }

  // Validate recipientFirstName
  if (!data.recipientFirstName || typeof data.recipientFirstName !== 'string' || data.recipientFirstName.length > 100) {
    return { valid: false, error: 'recipientFirstName is required and must be under 100 characters' };
  }

  // Validate optional fields
  if (data.companyName && (typeof data.companyName !== 'string' || data.companyName.length > 300)) {
    return { valid: false, error: 'companyName must be under 300 characters' };
  }

  if (data.eventDetail && (typeof data.eventDetail !== 'string' || data.eventDetail.length > 1000)) {
    return { valid: false, error: 'eventDetail must be under 1000 characters' };
  }

  if (data.jobTitle && (typeof data.jobTitle !== 'string' || data.jobTitle.length > 200)) {
    return { valid: false, error: 'jobTitle must be under 200 characters' };
  }

  if (data.signalId !== undefined && (typeof data.signalId !== 'string' || !UUID_PATTERN.test(data.signalId))) {
    return { valid: false, error: 'signalId must be a valid UUID' };
  }

  if (data.contactId !== undefined && (typeof data.contactId !== 'string' || !UUID_PATTERN.test(data.contactId))) {
    return { valid: false, error: 'contactId must be a valid UUID' };
  }

  return {
    valid: true,
    data: {
      type: data.type as "inmail" | "email",
      recipientName: String(data.recipientName).trim(),
      recipientFirstName: String(data.recipientFirstName).trim(),
      companyName: data.companyName ? String(data.companyName).trim() : undefined,
      eventDetail: data.eventDetail ? String(data.eventDetail).trim() : undefined,
      jobTitle: data.jobTitle ? String(data.jobTitle).trim() : undefined,
      signalId: typeof data.signalId === 'string' ? data.signalId : undefined,
      contactId: typeof data.contactId === 'string' ? data.contactId : undefined,
    }
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse and validate input
    const rawBody = await req.json();
    const validation = validateInput(rawBody);
    
    if (!validation.valid || !validation.data) {
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      type,
      recipientName,
      recipientFirstName,
      companyName,
      eventDetail,
      jobTitle,
      signalId,
      contactId,
    } = validation.data;

    // Les identifiants du ledger sont vérifiés avant l'appel fournisseur. Un
    // contact permet aussi de récupérer son signal réel sans déduire l'identité
    // depuis le nom ou l'entreprise du prompt.
    let ledgerSignalId = signalId;
    if (contactId) {
      const { data: contact, error: contactError } = await supabase
        .from("contacts")
        .select("id,signal_id")
        .eq("id", contactId)
        .maybeSingle();
      if (contactError || !contact) {
        throw new Error(`Ledger contact not found: ${contactError?.message || contactId}`);
      }
      if (signalId && contact.signal_id !== signalId) {
        throw new Error("Ledger contact does not belong to the supplied signal");
      }
      ledgerSignalId = contact.signal_id;
    } else if (signalId) {
      const { data: signal, error: signalError } = await supabase
        .from("signals")
        .select("id")
        .eq("id", signalId)
        .maybeSingle();
      if (signalError || !signal) {
        throw new Error(`Ledger signal not found: ${signalError?.message || signalId}`);
      }
    }
    
    // Lovable AI Gateway (Gemini 3.1) — clé auto-provisionnée
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured in environment");
    }

    // Fetch tonal charter for personalization
    const { data: charterData } = await supabase
      .from("tonal_charter")
      .select("*")
      .single();

    let tonalCharterBlock = "";
    if (charterData && charterData.confidence_score > 0.2 && charterData.charter_data) {
      const charter = charterData.charter_data;
      const confidence = Math.round(charterData.confidence_score * 100);
      
      tonalCharterBlock = `

═══════════════════════════════════════════════════════════════
CHARTE TONALE DE L'UTILISATEUR (Confiance: ${confidence}%)
Applique IMPÉRATIVEMENT ces préférences apprises :
═══════════════════════════════════════════════════════════════

${charter.summary ? `RÉSUMÉ DU STYLE: "${charter.summary}"` : ''}

FORMALITÉ:
- Niveau: ${charter.formality?.level || 'neutre'}
- Tutoiement: ${charter.formality?.tutoyment ? 'OUI - utilise systématiquement le tutoiement' : 'NON - utilise le vouvoiement'}
${charter.formality?.observations?.length ? charter.formality.observations.map((o: string) => `- ${o}`).join('\n') : ''}

STRUCTURE:
- Paragraphes max: ${charter.structure?.max_paragraphs || 3}
- Longueur des phrases: ${charter.structure?.sentence_length || 'moyenne'}
${charter.structure?.observations?.length ? charter.structure.observations.map((o: string) => `- ${o}`).join('\n') : ''}

VOCABULAIRE INTERDIT (NE JAMAIS UTILISER):
${charter.vocabulary?.forbidden_words?.length ? charter.vocabulary.forbidden_words.map((w: string) => `❌ "${w}"`).join(', ') : 'Aucun mot spécifiquement interdit'}
${charter.vocabulary?.forbidden_expressions?.length ? '\nExpressions interdites:\n' + charter.vocabulary.forbidden_expressions.map((e: string) => `❌ "${e}"`).join('\n') : ''}

VOCABULAIRE PRÉFÉRÉ (À PRIVILÉGIER):
${charter.vocabulary?.preferred_words?.length ? charter.vocabulary.preferred_words.map((w: string) => `✓ "${w}"`).join(', ') : 'Aucune préférence spécifique'}
${charter.vocabulary?.preferred_expressions?.length ? '\nExpressions préférées:\n' + charter.vocabulary.preferred_expressions.map((e: string) => `✓ "${e}"`).join('\n') : ''}

TON:
- Style: ${charter.tone?.style || 'professionnel'}
- Humour: ${charter.tone?.humor_allowed ? 'autorisé' : 'non autorisé'}
- Énergie: ${charter.tone?.energy_level || 'normale'}
${charter.tone?.observations?.length ? charter.tone.observations.map((o: string) => `- ${o}`).join('\n') : ''}

SIGNATURES PRÉFÉRÉES:
${charter.signatures?.preferred?.length ? charter.signatures.preferred.map((s: string) => `✓ "${s}"`).join('\n') : 'Pas de préférence'}

ACCROCHES PRÉFÉRÉES:
${charter.openings?.preferred?.length ? charter.openings.preferred.map((o: string) => `✓ "${o}"`).join('\n') : 'Pas de préférence'}

${type === 'email' && charter.subjects_email ? `
SUJETS EMAIL:
- Longueur max: ${charter.subjects_email.max_length || 50} caractères
- Style: ${charter.subjects_email.style || 'accrocheur'}
` : ''}

═══════════════════════════════════════════════════════════════
FIN DE LA CHARTE TONALE - APPLIQUE CES RÈGLES STRICTEMENT
═══════════════════════════════════════════════════════════════
`;
    }

    // AUCUN lien de recommandations fabriqué. L'ancien format
    // www.gourrmet.com/<entreprise>-recos renvoyait 404 pour TOUTES les
    // entreprises testées (audit du 2026-08-22) : ces pages n'ont jamais
    // existé. Chaque message poussait donc le prospect vers une impasse —
    // pire qu'aucun lien. Le seul lien autorisé est la page d'accueil.

    const systemPrompt = `Tu es Clotilde Gautier, Chargée d'évènements chez GOUЯRMET. Tu crées des cadeaux et animations sur-mesure pour marquer les moments importants des entreprises.

IMPORTANT — TU ES UNE FEMME : tous les accords doivent être au féminin ou neutres ("ravie", "je serais ravie", "enchantée", etc.). NE JAMAIS écrire d'accord masculin pour parler de toi.

RÈGLES ABSOLUES DE TONALITÉ :

1️⃣ VOUVOIEMENT SYSTÉMATIQUE — Toujours vouvoyer, sans exception.
2️⃣ ÉCRIRE TOUJOURS "GOUЯRMET" — Jamais "Gourrmet", jamais "Gourmet". Toujours GOUЯRMET avec le Я cyrillique.
3️⃣ COMMENCER PAR "Chère Madame," ou "Cher Monsieur," — Adapter selon le genre du destinataire.
4️⃣ MESSAGES ULTRA-SYNTHÉTIQUES — 80 mots MAX pour un InMail, 120 mots MAX pour un email.
5️⃣ NE JAMAIS INVENTER D'URL — Le seul lien autorisé est www.gourrmet.com (la page d'accueil). AUCUN lien du type www.gourrmet.com/[entreprise]-recos : ces pages n'existent pas et renvoient une erreur 404.
6️⃣ PROPOSER DES IDÉES CONCRÈTES — chocolat moulé, bougie personnalisée, bar à mousse, cocktail sur-mesure, etc.
7️⃣ TERMINER PAR UNE QUESTION LÉGÈRE — "L'idée vous inspire ?", "Si l'idée vous parle, on peut en discuter ?"
8️⃣ ACCORDS FÉMININS POUR TOI — "je serais ravie", "enchantée de", "je suis convaincue", etc.

STYLE :
- Phrases courtes, percutantes
- Pas de formules commerciales creuses
- Chaleureux mais professionnel
- Cite l'événement précisément dès le début
- Liste à puces pour les propositions concrètes

EXEMPLE :
"Chère Madame,
Fêter les 30 ans de Bouygues Telecom est un évènement important.
Chez GOUЯRMET nous avons des idées audacieuses pour vous accompagner :
- une bougie personnalisée à vos couleurs ?
- un chocolat moulé aux contours de votre nouvelle box IA ?
- un bar à mousse au chocolat entre collaborateurs ?
Je serais ravie d'imaginer un cadeau ou un évènement avec vous.
L'idée vous inspire ?"

CE QU'ON NE FAIT JAMAIS :
❌ Tutoyer
❌ Écrire "Gourrmet" ou "Gourmet" au lieu de "GOUЯRMET"
❌ Accord masculin pour parler de Clotilde ("ravi", "enchanté", "convaincu")
❌ "Je me permets de vous contacter..."
❌ "N'hésitez pas à me contacter..."
❌ Messages longs et verbeux
❌ Inventer une URL (pages [entreprise]-recos ou toute autre page qui n'existe pas)
❌ Oublier la signature complète

SIGNATURE OBLIGATOIRE (à coller telle quelle en fin de message) :
Clotilde GAUTIER
Chargée d'évènements, GOUЯRMET
📱 +33 7 83 31 94 43
✉️ clotilde@gourrmet.com
🌐 www.gourrmet.com
${tonalCharterBlock}`;

    let userPrompt = "";

    if (type === "inmail") {
      userPrompt = `Rédige un InMail LinkedIn ultra-court dans le style de Clotilde :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES STRICTES :
- 80 mots MAX
- Commence par "Chère Madame," ou "Cher Monsieur,"
- Vouvoiement systématique
- Accords FÉMININS pour Clotilde (ravie, enchantée…)
- Écrire GOUЯRMET (avec le Я)
- Cite l'événement précisément
- Propose des idées concrètes
- AUCUN lien inventé (pas de page -recos : elles n'existent pas) ; si un lien est naturel, uniquement www.gourrmet.com
- Termine par une question légère
- Signature COMPLÈTE OBLIGATOIRE (Clotilde GAUTIER, Chargée d'évènements GOUЯRMET, +33 7 83 31 94 43, clotilde@gourrmet.com, www.gourrmet.com)
- ZÉRO placeholder, ZÉRO crochet

Message uniquement, prêt à copier :`;
    } else {
      userPrompt = `Rédige un email de prospection dans le style de Clotilde :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES STRICTES :
- Objet : court, intrigant (max 50 caractères)
- Corps : 120 mots MAX
- Commence par "Chère Madame," ou "Cher Monsieur,"
- Vouvoiement systématique
- Accords FÉMININS pour Clotilde (ravie, enchantée, convaincue…)
- Écrire GOUЯRMET (avec le Я)
- Cite l'événement précisément
- Propose des idées concrètes en liste à puces
- AUCUN lien inventé (pas de page -recos : elles n'existent pas) ; si un lien est naturel, uniquement www.gourrmet.com
- Termine par une question légère
- Signature COMPLÈTE OBLIGATOIRE :
  Clotilde GAUTIER
  Chargée d'évènements, GOUЯRMET
  📱 +33 7 83 31 94 43
  ✉️ clotilde@gourrmet.com
  🌐 www.gourrmet.com
- ZÉRO placeholder, ZÉRO crochet

Format STRICT :
OBJET: [objet]
---
[corps de l'email avec signature complète]`;
    }

    console.log("Calling Lovable AI (Gemini 3.1) for:", type, recipientName, "| Event:", eventDetail?.substring(0, 50) || "none", "| Charter confidence:", charterData?.confidence_score || 0);

    await assertLovableAILedgerReady(supabase);
    const aiCall = await callMeteredLovableAI({
      supabase,
      apiKey: LOVABLE_API_KEY,
      operation: "generate_message",
      invocationId: crypto.randomUUID(),
      attempt: 1,
      model: AI_MODEL,
      itemsCount: 1,
      itemBasis: "recipient_submitted",
      signalId: ledgerSignalId,
      contactId,
      metadata: { message_type: type },
      body: {
        model: AI_MODEL,
        max_tokens: 4096,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      },
    });

    if (!aiCall.ok) {
      console.error("Lovable AI Gateway error:", aiCall.status, aiCall.rawBody);

      if (aiCall.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiCall.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crédits Lovable AI épuisés. Ajoutez des crédits dans Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Lovable AI Gateway error: ${aiCall.status}`);
    }

    if (!aiCall.payload) {
      throw new Error("Lovable AI Gateway returned invalid JSON");
    }
    const choices = Array.isArray(aiCall.payload.choices) ? aiCall.payload.choices : [];
    const firstChoice = choices[0] && typeof choices[0] === "object"
      ? choices[0] as Record<string, unknown>
      : null;
    const message = firstChoice?.message && typeof firstChoice.message === "object"
      ? firstChoice.message as Record<string, unknown>
      : null;
    const generatedText = typeof message?.content === "string" ? message.content : "";

    if (!generatedText) {
      await markLovableAIAttemptFailed(supabase, aiCall.requestKey, "empty_response");
      throw new Error("No text generated by AI");
    }

    // Parse email format if needed
    let result: { message: string; subject?: string } = { message: generatedText };
    
    if (type === "email" && generatedText.includes("OBJET:")) {
      const parts = generatedText.split("---");
      const subjectLine = parts[0].replace("OBJET:", "").trim();
      const body = parts.slice(1).join("---").trim();
      result = { message: body, subject: subjectLine };
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating message:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

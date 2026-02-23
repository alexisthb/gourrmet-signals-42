import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GenerateMessageRequest {
  type: "inmail" | "email";
  recipientName: string;
  recipientFirstName: string;
  companyName?: string;
  eventDetail?: string;
  jobTitle?: string;
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

  return {
    valid: true,
    data: {
      type: data.type as "inmail" | "email",
      recipientName: String(data.recipientName).trim(),
      recipientFirstName: String(data.recipientFirstName).trim(),
      companyName: data.companyName ? String(data.companyName).trim() : undefined,
      eventDetail: data.eventDetail ? String(data.eventDetail).trim() : undefined,
      jobTitle: data.jobTitle ? String(data.jobTitle).trim() : undefined,
    }
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Missing or invalid authorization header' }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
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
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { type, recipientName, recipientFirstName, companyName, eventDetail, jobTitle } = validation.data;
    
    // Get API key from environment only (not from settings table)
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured in environment");
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

    // Build the personalized recommendation link
    const companySlug = companyName ? companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'recommandations';
    const recoLink = `www.gourrmet.com/${companySlug}-recos`;

    const systemPrompt = `Tu es Patrick Oualid, fondateur de GOUЯRMET. Tu crées des cadeaux et animations sur-mesure pour marquer les moments importants des entreprises.

RÈGLES ABSOLUES DE TONALITÉ (apprises des vrais messages de Patrick) :

1️⃣ VOUVOIEMENT SYSTÉMATIQUE — Toujours vouvoyer, sans exception.
2️⃣ ÉCRIRE TOUJOURS "GOUЯRMET" — Jamais "Gourrmet", jamais "Gourmet". Toujours GOUЯRMET avec le Я.
3️⃣ COMMENCER PAR "Chère Madame," ou "Cher Monsieur," — Adapter selon le genre du destinataire.
4️⃣ MESSAGES ULTRA-SYNTHÉTIQUES — 80 mots MAX pour un InMail, 120 mots MAX pour un email. Court, punchy, direct.
5️⃣ INCLURE UN LIEN DE RECOMMANDATIONS PERSONNALISÉ — Format : www.gourrmet.com/[entreprise]-recos
6️⃣ PROPOSER DES IDÉES CONCRÈTES — Pas de vague "on peut vous accompagner". Des exemples précis : chocolat moulé, bougie personnalisée, bar à mousse, cocktail sur-mesure, etc.
7️⃣ TERMINER PAR UNE QUESTION LÉGÈRE — "L'idée vous inspire ?", "Si l'idée vous parle, on peut en discuter ?", "Regardez et on en discute ?"

STYLE DE PATRICK :
- Phrases courtes, percutantes
- Pas de formules commerciales creuses
- Chaleureux mais professionnel (vouvoiement + proximité)
- Cite l'événement précisément dès le début
- Liste à puces pour les propositions concrètes
- Le lien de recommandations est présenté naturellement : "Regardez ce qu'on a préparé pour vous : [lien]" ou "Voici ce qu'on a imaginé pour [entreprise] : [lien]"

EXEMPLES RÉELS DE PATRICK :

Email pour les 30 ans de Bouygues Telecom :
"Chère Madame,
Fêter les 30 ans de Bouygues Telecom est un évènement important.
Chez GOUЯRMET nous avons des idées audacieuses pour vous accompagner
- une bougie personnalisée à vos couleurs ?
- un chocolat moulé aux contours de votre nouvelle box IA ?
- Un bar à mousse au chocolat ou un bar à glace pour fêter cet évènement entre collaborateurs ?
- Un bar à cocktail où chaque flacon serait à vos couleurs ?
Vous l'aurez compris nous pouvons créer un évènement ou un cadeau ensemble
Regardez comme c'est joli et on en discute après cela vous convient ?
[lien]
L'idée vous inspire ?"

Email pour les 55 ans de Point S :
"Chère Madame,
55 ans pour Point S. Un demi-siècle à équiper les Français sur les routes, à grandir jusqu'à devenir leader européen. Pas mal pour un groupe lyonnais qui a démarré avec quelques pneus et beaucoup d'ambition.
Maintenant, comment peut on valoriser cet anniversaire ?
Chez GOUЯRMET, on sélectionne des cadeaux audacieux et faits en France. On propose des animations gourmandes. Un chocolat moulé aux contours de votre logo, une bougie à vos couleurs, un bar à mousse au chocolat ou un cocktail prêt-à-déguster avec un message sur l'étiquette.
Voici ce qu'on a préparé pour vous. Regardez : [lien]
Si l'idée vous parle, on peut en discuter ?"

Email pour une performance commerciale (Alstom) :
"Chère Madame,
Nous les commerciaux nous tenons beaucoup à la "reconnaissance"
GOUЯRMET peut vous proposer un évènement fédérateur ou un cadeau personnalisé made in France.
Regardez ce que nous avons imaginé pour ALSTOM !
[lien]"

CE QU'ON NE FAIT JAMAIS :
❌ Tutoyer
❌ Écrire "Gourrmet" ou "Gourmet" au lieu de "GOUЯRMET"
❌ "Je me permets de vous contacter..."
❌ "C'est avec un grand intérêt..."
❌ "N'hésitez pas à me contacter..."
❌ Messages longs et verbeux
❌ Oublier le lien de recommandations
❌ Oublier la signature complète

Patrick Oualid — +33 7 83 31 94 43 | patrick.oualid@gourrmet.com | gourrmet.com
${tonalCharterBlock}`;

    let userPrompt = "";

    if (type === "inmail") {
      userPrompt = `Rédige un InMail LinkedIn ultra-court dans le style de Patrick :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES STRICTES :
- 80 mots MAX (ultra-synthétique)
- Commence par "Chère Madame," ou "Cher Monsieur," selon le contexte
- Vouvoiement systématique
- Écrire GOUЯRMET (avec le Я)
- Cite l'événement précisément
- Propose des idées concrètes (chocolat moulé, bougie, bar à mousse, etc.)
- Inclus le lien : ${recoLink}
- Termine par une question légère
- ZÉRO placeholder, ZÉRO crochet — message prêt à envoyer

Format de signature LinkedIn :
--
Patrick Oualid
Fondateur, GOUЯRMET
📱 +33 7 83 31 94 43
✉️ patrick.oualid@gourrmet.com
🌐 www.gourrmet.com

Message uniquement, prêt à copier :`;
    } else {
      userPrompt = `Rédige un email de prospection dans le style de Patrick :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES STRICTES :
- Objet : court, intrigant, lié à l'événement (max 50 caractères)
- Corps : 120 mots MAX (ultra-synthétique)
- Commence par "Chère Madame," ou "Cher Monsieur,"
- Vouvoiement systématique
- Écrire GOUЯRMET (avec le Я)
- Cite l'événement précisément
- Propose des idées concrètes en liste à puces
- Inclus le lien de recommandations : ${recoLink}
- Termine par une question légère
- Signature COMPLÈTE OBLIGATOIRE

Format de signature email :
--
Patrick Oualid
Fondateur, GOUЯRMET
📱 +33 7 83 31 94 43
✉️ patrick.oualid@gourrmet.com
🌐 www.gourrmet.com

- ZÉRO placeholder, ZÉRO crochet — email prêt à envoyer

Format STRICT :
OBJET: [objet]
---
[corps de l'email avec signature complète]`;
    }

    console.log("Calling Claude with prompt for:", type, recipientName, "| Event:", eventDetail?.substring(0, 50) || "none", "| Charter confidence:", charterData?.confidence_score || 0);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Anthropic API error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();
    const generatedText = data.content?.[0]?.text;

    if (!generatedText) {
      throw new Error("No text generated by Claude");
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

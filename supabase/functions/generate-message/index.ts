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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { type, recipientName, recipientFirstName, companyName, eventDetail, jobTitle }: GenerateMessageRequest = await req.json();
    
    // Try env first, then settings table
    let ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "claude_api_key")
        .single();
      ANTHROPIC_API_KEY = setting?.value || null;
    }

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured (neither in env nor settings)");
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

    const systemPrompt = `Tu es Patrick Oualid, fondateur de Gourrmet. Tu crées des coffrets gastronomiques d'exception pour marquer les moments importants des entreprises.

TRIANGLE D'OR DU MESSAGE PARFAIT :

1️⃣ L'ÉVÉNEMENT DÉCLENCHEUR (pourquoi maintenant ?)
- Cite l'événement PRÉCIS dès la première phrase, naturellement
- Pas "j'ai vu votre actualité" mais "Votre levée de 12M€ avec Partech..."
- Montre que tu sais de quoi tu parles, pas que tu as googlé

2️⃣ LA FONCTION DU DESTINATAIRE (pourquoi lui/elle ?)
- Adapte le message à son rôle : un DRH pense équipes, un CEO pense image, un CFO pense ROI
- Fais le lien entre SA fonction et l'événement
- Exemple DRH + levée : "Vos équipes ont bossé dur pour cette levée..."
- Exemple CEO + acquisition : "Intégrer deux cultures d'entreprise, c'est votre défi des prochains mois..."

3️⃣ CE QUE TU PROPOSES (subtilement)
- Ne vends pas, suggère une possibilité
- Gourrmet = coffrets gastronomiques haut de gamme, champagnes d'exception, créations sur-mesure
- Le cadeau comme outil stratégique, pas comme dépense
- "Marquer ce moment", "créer un souvenir", "remercier avec élégance"

TON IMPÉRATIF :
- Écris comme un pote entrepreneur, pas comme un commercial
- Un brin d'espièglerie, une touche d'humour léger
- JAMAIS de formules creuses : "je me permets", "c'est avec plaisir", "n'hésitez pas"
- JAMAIS de superlatifs vides : "extraordinaire", "exceptionnel", "remarquable"
- Phrases courtes. Rythme. Punch.
- Tu tutoies ou vouvoies selon le contexte (tech/startup = tu, corporate = vous)

EXEMPLES SELON LA FONCTION :

Pour un DRH après une levée de fonds :
"15M€. Vos équipes ont dû enchainer les nuits blanches pour boucler ce tour. Maintenant qu'on souffle, comment on les remercie ? Un mail de félicitations ? Bof. Un afterwork pizza ? Déjà vu. Chez Gourrmet, on fait des coffrets qui marquent. Du champagne qu'on n'oublie pas, des produits d'artisans triés sur le volet. Si l'idée vous parle, on en discute ?"

Pour un CEO après une acquisition :
"L'acquisition de [X], c'est fait. Maintenant, le vrai travail commence : fusionner deux cultures, rassurer les équipes, créer une nouvelle dynamique. Les premiers gestes comptent. Un coffret bien pensé pour les managers clés des deux côtés, ça peut aider à briser la glace. C'est ce qu'on fait chez Gourrmet — des cadeaux d'affaires qui disent quelque chose."

Pour un Directeur Commercial après un anniversaire :
"10 ans. Une décennie à convaincre des clients, à closer des deals, à construire une base solide. Vos clients historiques méritent mieux qu'un mail automatique. Et si on marquait le coup avec des coffrets qui leur rappellent pourquoi ils vous font confiance depuis si longtemps ?"

CE QU'ON NE FAIT JAMAIS :
❌ "Je me permets de vous contacter suite à..."
❌ "C'est avec un grand intérêt que j'ai découvert..."
❌ "N'hésitez pas à me contacter si..."
❌ Mentionner l'événement vaguement ("votre actualité récente")
❌ Ignorer la fonction de la personne
❌ Faire un pitch commercial lourd

Patrick Oualid — +33 7 83 31 94 43 | patrick.oualid@gourrmet.com | gourrmet.com
${tonalCharterBlock}`;

    let userPrompt = "";

    if (type === "inmail") {
      userPrompt = `Rédige un InMail LinkedIn court et percutant :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES :
- 150 mots MAX (c'est un InMail, pas un roman)
- Première phrase = l'événement, cité précisément
- Adapte le message à sa FONCTION (un DRH ≠ un CEO ≠ un Directeur Commercial)
- Fais le lien naturel entre son rôle, l'événement, et ce que Gourrmet peut apporter
- Termine par une question ouverte ou une proposition légère
- Signature : juste le prénom et les coordonnées
- ZÉRO placeholder, ZÉRO crochet — message prêt à envoyer
- Espiègle, direct, humain

Message uniquement, prêt à copier :`;
    } else {
      userPrompt = `Rédige un email de prospection élégant :

DESTINATAIRE :
- Nom : ${recipientFirstName}
- Fonction : ${jobTitle || 'Non précisée'}
- Entreprise : ${companyName || 'Non précisée'}

ÉVÉNEMENT DÉCLENCHEUR :
${eventDetail || 'Aucun événement spécifique — reste générique mais garde le ton'}

RÈGLES :
- Objet : court, intrigant, lié à l'événement (max 50 caractères)
- Corps : 200 mots MAX
- Première phrase = l'événement, cité précisément
- Adapte le message à sa FONCTION
- Montre que tu comprends ses enjeux liés à cet événement
- Présente Gourrmet subtilement comme une solution, pas comme un pitch
- Termine par une ouverture légère
- Signature complète de Patrick
- ZÉRO placeholder, ZÉRO crochet — email prêt à envoyer

Format STRICT :
OBJET: [objet]
---
[corps de l'email]`;
    }

    console.log("Calling Claude Opus with prompt for:", type, recipientName, "| Event:", eventDetail?.substring(0, 50) || "none", "| Charter confidence:", charterData?.confidence_score || 0);

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

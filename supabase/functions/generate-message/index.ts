import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { type, recipientName, recipientFirstName, companyName, eventDetail, jobTitle }: GenerateMessageRequest = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const systemPrompt = `Tu es Patrick Oualid, fondateur de Gourrmet, spécialiste des cadeaux d'affaires gastronomiques haut de gamme.

PRINCIPE CLÉ : LA CONTEXTUALISATION EST TOUT
Le message doit être ENTIÈREMENT construit autour du contexte fourni. Ce n'est pas une accroche, c'est le cœur du message.
- Si la personne vient d'être nommée : parle de ce que ça représente, les défis des premiers mois, l'importance de marquer les esprits
- Si c'est une levée de fonds : évoque ce que ça signifie pour l'équipe, les prochaines étapes, célébrer les investisseurs
- Si c'est un anniversaire d'entreprise : parle de ce milestone, de l'histoire construite, remercier les équipes
- Si c'est une acquisition/fusion : aborde l'intégration des équipes, les changements culturels

RÈGLES D'ÉCRITURE IMPÉRATIVES :
- Le contexte doit être tissé tout au long du message, pas juste mentionné au début
- Montre que tu COMPRENDS ce que vit le destinataire, pas juste que tu as lu un article
- Fais des connexions intelligentes entre leur actualité et ce que Gourrmet peut apporter
- Écris comme un vrai humain, PAS comme une IA
- INTERDIT : superlatifs vides ("extraordinaire", "remarquable", "formidable"), formules creuses ("c'est avec grand plaisir", "je me permets de")
- Phrases courtes et directes. Pas de fioritures
- Tu peux être légèrement provocateur ou décalé
- Sois spécifique : cite des éléments précis du contexte
- Le ton doit être celui d'un entrepreneur qui parle à un autre entrepreneur

EXEMPLES DE CONTEXTUALISATION RÉUSSIE :
✅ Levée de fonds : "15M€, c'est le genre de nouvelle qui mérite plus qu'un mail de félicitations. Vos investisseurs ont parié sur vous — ça se célèbre. Et vos équipes qui ont bossé pour en arriver là ? Elles méritent qu'on marque le coup. Chez Gourrmet, on crée des coffrets qui transforment ces moments en souvenirs. Champagnes d'exception, produits d'artisans triés sur le volet."

✅ Nomination : "Nouveau DG chez ${companyName} — les 100 premiers jours, c'est là que tout se joue. Vous allez rencontrer des dizaines de personnes clés, poser vos marques, créer des alliances. Un cadeau bien choisi au bon moment, ça peut changer une relation. C'est exactement ce qu'on fait chez Gourrmet."

✅ Anniversaire : "10 ans de ${companyName}. Une décennie à construire quelque chose. Ça ne se fête pas avec un gâteau de supermarché. Vos clients historiques, vos partenaires fidèles, votre équipe — ils méritent un geste à la hauteur de ce que vous avez accompli ensemble."

EXEMPLES À NE PAS FAIRE :
❌ "J'ai vu votre actualité et c'est formidable" (trop générique)
❌ "Suite à votre nomination, je me permets..." (robot)
❌ Mentionner le contexte en une phrase puis passer à autre chose
❌ "Je serais ravi d'échanger avec vous sur ce sujet"

Contact : +33 7 83 31 94 43 | patrick.oualid@gourrmet.com | www.gourrmet.com`;

    let userPrompt = "";

    if (type === "inmail") {
      userPrompt = `Rédige un message LinkedIn InMail de prospection hyper-contextualisé pour :
- Destinataire : ${recipientFirstName} ${recipientName.split(' ').slice(1).join(' ')}
${jobTitle ? `- Poste actuel : ${jobTitle}` : ''}
${companyName ? `- Entreprise : ${companyName}` : ''}
${eventDetail ? `- CONTEXTE CLÉ À EXPLOITER : ${eventDetail}` : '- Pas de contexte spécifique (sois plus générique mais garde le ton)'}

Instructions critiques :
- Maximum 200 mots
- Le contexte doit être le FIL ROUGE du message, pas juste une accroche
- Montre que tu comprends ce que cette actualité signifie pour eux concrètement
- Fais le lien naturel avec comment Gourrmet peut accompagner CE moment précis
- Pose une question ou fais une proposition concrète liée au contexte
- Inclus les coordonnées de Patrick à la fin
- AUCUN placeholder, AUCUN crochet, tout doit être prêt à envoyer
- Ton direct, chaleureux, d'entrepreneur à entrepreneur

Génère uniquement le message, prêt à copier-coller.`;
    } else {
      userPrompt = `Rédige un email de prospection hyper-contextualisé pour :
- Destinataire : ${recipientFirstName} ${recipientName.split(' ').slice(1).join(' ')}
${jobTitle ? `- Poste actuel : ${jobTitle}` : ''}
${companyName ? `- Entreprise : ${companyName}` : ''}
${eventDetail ? `- CONTEXTE CLÉ À EXPLOITER : ${eventDetail}` : '- Pas de contexte spécifique (sois plus générique mais garde le ton)'}

Instructions critiques :
- Maximum 250 mots pour le corps
- Génère un objet d'email qui fait référence directe au contexte (max 60 caractères)
- Le contexte doit être tissé TOUT AU LONG du message
- Montre que tu comprends les implications de cette actualité pour le destinataire
- Présente Gourrmet comme LA solution pour marquer CE moment précis
- Sois spécifique sur ce que tu proposes (coffrets, champagnes, créations sur-mesure)
- Inclus les coordonnées de Patrick à la fin
- AUCUN placeholder, AUCUN crochet, tout doit être prêt à envoyer
- Ton professionnel, élégant, mais authentique

Format de réponse STRICT :
OBJET: [l'objet de l'email]
---
[le corps de l'email]`;
    }

    console.log("Calling Claude Opus with prompt for:", type, recipientName);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-opus-4-1-20250805",
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

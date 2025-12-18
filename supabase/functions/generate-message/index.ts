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

PRINCIPE CLÉ N°1 : NOMMER CLAIREMENT L'ÉVÉNEMENT DÉCLENCHEUR
Dès les premières lignes, tu dois expliciter POURQUOI tu contactes cette personne MAINTENANT.
- "J'ai vu que vous venez d'annoncer une levée de 15M€..."
- "Votre nomination au poste de DG chez X a attiré mon attention..."
- "L'acquisition de Y par votre groupe, annoncée la semaine dernière..."
- "Les 10 ans de ${companyName || 'votre entreprise'} approchent..."

Le destinataire doit comprendre en 2 secondes : "Ah, il me contacte parce qu'il a vu [cet événement précis]".

PRINCIPE CLÉ N°2 : LA CONTEXTUALISATION PROFONDE
Après avoir nommé l'événement, montre que tu COMPRENDS ce que ça implique :
- Une levée de fonds = remercier les investisseurs, célébrer l'équipe, nouveaux défis
- Une nomination = premiers 100 jours cruciaux, créer des alliances, marquer les esprits
- Un anniversaire = remercier les fidèles, célébrer le chemin parcouru
- Une acquisition = intégrer les équipes, créer une culture commune

RÈGLES D'ÉCRITURE IMPÉRATIVES :
- PREMIÈRE PHRASE = l'événement déclencheur, explicitement nommé
- Le contexte doit être tissé tout au long du message
- Fais le lien naturel entre LEUR événement et ce que Gourrmet peut apporter
- Écris comme un vrai humain, PAS comme une IA
- INTERDIT : superlatifs vides, formules creuses ("c'est avec grand plaisir", "je me permets de")
- Phrases courtes et directes
- Sois spécifique : cite des éléments précis du contexte

EXEMPLES RÉUSSIS :
✅ "Votre levée de 15M€ annoncée hier — félicitations. Ce genre de milestone, ça ne se fête pas avec un simple mail interne. Vos investisseurs ont misé sur vous, votre équipe a bossé dur pour en arriver là. Chez Gourrmet, on crée des coffrets qui transforment ces moments en souvenirs."

✅ "J'ai vu l'annonce de votre nomination comme DG chez ${companyName || 'X'}. Les 100 premiers jours, c'est là que tout se joue : rencontrer les bonnes personnes, poser vos marques. Un cadeau bien choisi au bon moment peut changer une relation."

✅ "10 ans de ${companyName || 'votre entreprise'} cette année. Une décennie à construire quelque chose — ça mérite plus qu'un gâteau en salle de pause. Vos clients historiques, vos partenaires, votre équipe : ils méritent un geste à la hauteur."

À NE PAS FAIRE :
❌ "J'ai vu votre actualité récente" (trop vague, quel événement ?)
❌ Ne pas mentionner l'événement du tout
❌ Mentionner l'événement vaguement puis passer à autre chose

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

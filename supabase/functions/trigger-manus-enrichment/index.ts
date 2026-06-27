import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface EnrichmentRequest {
  signal_id: string;
}

interface Persona {
  name: string;
  isPriority: boolean;
}

// Default personas if none configured
const DEFAULT_PERSONAS: Persona[] = [
  { name: 'Assistant(e) de direction', isPriority: true },
  { name: 'Office Manager', isPriority: true },
  { name: 'Responsable RH', isPriority: false },
  { name: 'Directeur Général', isPriority: false },
  { name: 'DAF / CFO', isPriority: false },
  { name: 'Responsable Communication', isPriority: false },
  { name: 'Responsable Achats', isPriority: false },
];

// Fetch personas from settings or return defaults
async function getPersonas(supabase: any, source: 'presse' | 'pappers' | 'linkedin'): Promise<Persona[]> {
  try {
    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", `personas_${source}`)
      .single();
    
    if (setting?.value) {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[Personas] Loaded ${parsed.length} personas from settings for ${source}`);
        return parsed;
      }
    }
  } catch (e) {
    console.log(`[Personas] Using default personas for ${source}`);
  }
  return DEFAULT_PERSONAS;
}

// Build prompt section for personas
function buildPersonaPromptSection(personas: Persona[]): { prompt: string; keywords: string } {
  const priorityPersonas = personas.filter(p => p.isPriority);
  const otherPersonas = personas.filter(p => !p.isPriority);
  
  let prompt = `## PROFILS PRIORITAIRES À CIBLER (par ordre de priorité)\n`;
  
  priorityPersonas.forEach((p, i) => {
    prompt += `${i + 1}. **${p.name}** - Contact prioritaire\n`;
  });
  
  if (otherPersonas.length > 0) {
    prompt += `\n## PROFILS SECONDAIRES (si prioritaires non trouvés)\n`;
    otherPersonas.forEach((p, i) => {
      prompt += `${priorityPersonas.length + i + 1}. ${p.name}\n`;
    });
  }
  
  // Build search keywords from persona names
  const keywords = personas.map(p => p.name.toLowerCase()).join(' OR ');
  
  return { prompt, keywords };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { signal_id }: EnrichmentRequest = await req.json();

    if (!signal_id) {
      return new Response(
        JSON.stringify({ error: "signal_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Manus Enrichment] Starting enrichment for signal: ${signal_id}`);

    // 1. Fetch the signal
    const { data: signal, error: signalError } = await supabase
      .from("signals")
      .select("*")
      .eq("id", signal_id)
      .single();

    if (signalError || !signal) {
      console.error("[Manus Enrichment] Signal not found:", signalError);
      return new Response(
        JSON.stringify({ error: "Signal not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GATE Pappers : suspend l'enrichissement contacts des signaux Pappers.
    // Réversible via settings.pappers_enrichment_enabled (défaut actif si absent ;
    // seul value==='false' bloque, même convention que auto_enrich_enabled).
    // Point de coupure terminal : toutes les voies (transfert front, relance Settings,
    // SQL relaunch_failed) convergent ici, seul appelant de l'API Manus contacts.
    if ((signal.source_name || '') === 'Pappers') {
      const { data: pappersGate } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "pappers_enrichment_enabled")
        .maybeSingle();
      if (pappersGate?.value === 'false') {
        console.log(`[Manus Enrichment] Skipped (Pappers enrichment suspended): ${signal_id}`);
        return new Response(
          JSON.stringify({ skipped: true, reason: "pappers_enrichment_suspended", signal_id }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Determine source type from signal
    const signalType = signal.signal_type || '';
    const sourceName = signal.source_name || '';
    let personaSource: 'presse' | 'pappers' | 'linkedin' = 'presse';
    
    if (signalType.includes('linkedin') || sourceName.toLowerCase().includes('linkedin')) {
      personaSource = 'linkedin';
    } else if (signalType.includes('anniversaire') || signalType.includes('nomination') || 
               signalType.includes('capital') || sourceName.toLowerCase().includes('pappers')) {
      personaSource = 'pappers';
    }
    
    // Fetch configured personas
    const personas = await getPersonas(supabase, personaSource);
    const priorityPersonas = personas.filter(p => p.isPriority);
    const otherPersonas = personas.filter(p => !p.isPriority);
    
    console.log(`[Manus Enrichment] Using ${personas.length} personas (${priorityPersonas.length} priority) for source: ${personaSource}`);

    // 2. Check if already enriched
    const { data: existingEnrichment } = await supabase
      .from("company_enrichment")
      .select("*")
      .eq("signal_id", signal_id)
      .maybeSingle();

    if (existingEnrichment && existingEnrichment.status === "completed") {
      console.log("[Manus Enrichment] Signal already enriched");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Signal already enriched",
          enrichment: existingEnrichment 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Update signal status to processing
    await supabase
      .from("signals")
      .update({ enrichment_status: "processing" })
      .eq("id", signal_id);

    // 4. Create or update enrichment record
    let enrichmentId: string;
    if (existingEnrichment) {
      enrichmentId = existingEnrichment.id;
      await supabase
        .from("company_enrichment")
        .update({ status: "processing" })
        .eq("id", enrichmentId);
    } else {
      const { data: newEnrichment, error: insertError } = await supabase
        .from("company_enrichment")
        .insert({
          signal_id,
          company_name: signal.company_name,
          status: "processing",
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create enrichment: ${insertError.message}`);
      }
      enrichmentId = newEnrichment.id;
    }

    console.log(`[Manus Enrichment] Enrichment record created: ${enrichmentId}`);

    // 5. Try Manus API first if key is available - check env then settings
    let MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");
    if (!MANUS_API_KEY) {
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "manus_api_key")
        .single();
      MANUS_API_KEY = setting?.value || null;
    }
    // Build persona sections for prompt
    const priorityList = priorityPersonas.map((p, i) => `${i + 1}. **${p.name}** - Contact PRIORITAIRE à cibler en premier`).join('\n');
    const secondaryList = otherPersonas.map((p, i) => `${priorityPersonas.length + i + 1}. ${p.name}`).join('\n');
    const searchKeywords = personas.map(p => {
      // Simplify for LinkedIn search
      const simplified = p.name
        .replace(/\(e\)/g, '')
        .replace(/\//g, ' OR ')
        .toLowerCase()
        .trim();
      return simplified;
    }).join(' OR ');
    
    if (MANUS_API_KEY) {
      // Use real Manus AI Agent API
      console.log("[Manus Enrichment] Calling Manus AI Agent API...");
      
      try {
        const manusPrompt = `Tu es un expert en recherche de contacts B2B spécialisé dans l'identification des vrais décideurs opérationnels.

## ENTREPRISE CIBLE
- Nom: ${signal.company_name}
- Secteur: ${signal.sector || "Non spécifié"}
- Contexte: ${signal.event_detail || signal.signal_type}

## MISSION
Trouve 3 à 5 contacts OPÉRATIONNELS qui prennent réellement les décisions d'achat de services/produits pour cette entreprise.

## PROFILS PRIORITAIRES À CIBLER (par ordre de priorité)
${priorityList}

${secondaryList ? `## PROFILS SECONDAIRES (si prioritaires non trouvés)\n${secondaryList}` : ''}

⚠️ ÉVITER: CEO, DG, VP, "Head of" stratégiques qui ne gèrent pas les achats opérationnels.

## STRATÉGIE DE RECHERCHE MULTI-SOURCES
Utilise TOUTES les sources disponibles. Si l'une échoue ou est indisponible (ex. scraping LinkedIn / Apify hors service), NE T'ARRÊTE PAS — passe à la suivante. Ne renvoie JAMAIS un résultat vide sans avoir essayé les sources alternatives ci-dessous.

### 1. LinkedIn (si le scraping est disponible)
Profils correspondant aux personas pour "${signal.company_name}". Mots-clés: ${searchKeywords}.
Extrait : firstName, lastName, headline, position (titre + département), ville.

### 2. SI LINKEDIN/SCRAPING INDISPONIBLE OU VIDE → sources alternatives (OBLIGATOIRE avant de rendre un résultat vide)
- **Site web de l'entreprise** : pages « Équipe / À propos / Direction / Contact / Mentions légales » — les fonctions support, achats et direction y sont souvent nommées.
- **Recherche web** : « ${signal.company_name} assistante de direction », « ${signal.company_name} office manager », « ${signal.company_name} responsable achats / services généraux ».
- **Annuaires d'entreprises FR** : Pappers, Societe.com, Infogreffe (dirigeants & représentants légaux).
- **Presse / article du signal** : l'actualité cite souvent des personnes nommées.
- **Profils LinkedIn publics** atteints via le moteur de recherche (lecture de la page publique, sans scraping).

### 3. Emails
Pour chaque personne RÉELLE identifiée, trouve l'email professionnel via des sources B2B fiables.
Si introuvable, tu peux proposer le format standard prenom.nom@domaine — MAIS marque-le \`"email_status": "pattern"\` (jamais présenté comme vérifié). Sinon \`"email_status": "verified"\`.

### 4. Filtrage
Écarte les profils stratégiques (CEO, DG, VP, Head of, Director). Garde 3 à 5 contacts opérationnels maximum, priorité aux personas prioritaires.

## RÈGLE ANTI-FABRICATION (ABSOLUE)
- Chaque contact = une **personne réelle** trouvée dans une source **citable** → renseigne obligatoirement le champ \`"source"\` (ex: "linkedin", "site web entreprise", "pappers", "presse", "recherche web").
- N'INVENTE JAMAIS un nom, un prénom ou un email. Si tu ne peux pas vérifier qu'une personne existe réellement, NE l'inclus PAS.
- 1 contact réel vaut mieux que 5 inventés. Si rien de vérifiable APRÈS avoir essayé TOUTES les sources ci-dessus → tableau vide, avec \`"error"\` décrivant précisément ce qui a été tenté (et quelle source a échoué).

## FORMAT DE RÉPONSE (JSON OBLIGATOIRE)
{
  "contacts": [
    {
      "full_name": "Prénom Nom",
      "first_name": "Prénom",
      "last_name": "Nom",
      "job_title": "Titre exact",
      "department": "Département",
      "location": "Ville, Pays",
      "email": "email@company.com",
      "email_status": "verified | pattern",
      "linkedin_url": "https://linkedin.com/in/username",
      "source": "linkedin | site web entreprise | pappers | presse | recherche web",
      "is_priority_persona": true/false
    }
  ],
  "company_info": {
    "website": "https://...",
    "industry": "Secteur",
    "employee_count": "Fourchette",
    "headquarters": "Ville"
  },
  "search_method": "Description courte de la méthode utilisée"
}

## GESTION DES ERREURS
Si l'entreprise n'existe pas ou aucun contact trouvé, retourne:
{
  "contacts": [],
  "company_info": {
    "website": "N/A",
    "industry": "N/A",
    "employee_count": "N/A",
    "headquarters": "N/A"
  },
  "search_method": "Recherche effectuée mais aucun contact opérationnel trouvé",
  "error": "Aucun contact opérationnel identifié pour ${signal.company_name} dans le secteur ${signal.sector || 'Non spécifié'}"
}

## CRITÈRES DE QUALITÉ
- Contacts vérifiés
- Emails professionnels valides
- Titres et départements exacts
- Profils LinkedIn valides
- Minimum 3 contacts, maximum 5
- Priorité aux personas prioritaires configurés

## IMPORTANT
- Ne pose JAMAIS de questions - exécute directement la recherche
- Retourne TOUJOURS un JSON valide
- Si aucun contact valide trouvé, retourne un tableau vide plutôt qu'inventer
- Marque is_priority_persona=true pour les contacts correspondant aux personas prioritaires`;

        const manusResponse = await fetch("https://api.manus.ai/v1/tasks", {
          method: "POST",
          headers: {
            "API_KEY": MANUS_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: manusPrompt,
            agentProfile: "manus-1.6",
            taskMode: "agent",
          }),
        });

        if (manusResponse.ok) {
          const manusResult = await manusResponse.json();
          // Ne pas logger la réponse complète (peut contenir des données contact/PII).
          // Seuls les identifiants techniques sont utiles pour debug.
          const taskId = manusResult.id || manusResult.task_id;
          const taskUrl = manusResult.task_url || manusResult.url || `https://manus.ai/tasks/${taskId}`;
          
          if (!taskId) {
            console.error("[Manus Enrichment] No task_id found in Manus response");
            throw new Error("Manus API did not return a task_id");
          }
          
          console.log(`[Manus Enrichment] Manus task created: ${taskId}`);
          
          // Manus tasks are async - store task_id for later polling
          const rawDataPayload = { 
            manus_task_id: taskId, 
            manus_task_url: taskUrl,
            started_at: new Date().toISOString(),
            personas_used: personas,
            persona_source: personaSource,
          };
          
          const { error: updateError } = await supabase
            .from("company_enrichment")
            .update({
              status: "manus_processing",
              enrichment_source: "manus",
              raw_data: rawDataPayload
            })
            .eq("id", enrichmentId);

          if (updateError) {
            console.error("[Manus Enrichment] Failed to update enrichment:", updateError.message);
            throw new Error(`Failed to update enrichment: ${updateError.message}`);
          }

          const { error: signalUpdateError } = await supabase
            .from("signals")
            .update({ enrichment_status: "manus_processing" })
            .eq("id", signal_id);

          if (signalUpdateError) {
            console.error("[Manus Enrichment] Failed to update signal status:", signalUpdateError.message);
          }

          return new Response(
            JSON.stringify({
              success: true,
              message: "Manus agent lancé - recherche de contacts en cours (peut prendre quelques minutes)",
              manus_task_id: taskId,
              manus_task_url: taskUrl,
              enrichment_id: enrichmentId,
              personas_count: personas.length,
              priority_personas_count: priorityPersonas.length,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          const errorText = await manusResponse.text();
          console.error("[Manus Enrichment] Manus API error:", manusResponse.status, errorText.slice(0, 500));
        }
      } catch (manusError) {
        console.error("[Manus Enrichment] Manus API call failed:", manusError instanceof Error ? manusError.message : manusError);
      }
    }

    // Manus indisponible (clé manquante OU appel échoué) : on échoue explicitement.
    // Le fallback Lovable AI et le mock generator ont été retirés (GR-002) car ils
    // injectaient des faux contacts (Jean/Marie/Sophie/Pierre + emails inventés)
    // indistinguables des vrais — risque que Clotilde prospecte des contacts fictifs.
    await supabase
      .from("company_enrichment")
      .update({
        status: "failed",
        // P2 : on pose AUSSI la colonne error_message (l'UI lit error_message, pas
        // raw_data.failure_reason) -> plus de 'failed' muet.
        error_message: !MANUS_API_KEY
          ? "Service d'enrichissement Manus non configuré (MANUS_API_KEY manquante)."
          : "Appel Manus échoué — aucun contact créé. Réessayez plus tard.",
        raw_data: {
          failure_reason: !MANUS_API_KEY ? "MANUS_API_KEY missing" : "Manus API call failed",
          outcome: !MANUS_API_KEY ? "manus_not_configured" : "manus_api_failed",
          failed_at: new Date().toISOString(),
        },
      })
      .eq("id", enrichmentId);

    await supabase
      .from("signals")
      .update({ enrichment_status: "failed" })
      .eq("id", signal_id);

    const failureMessage = !MANUS_API_KEY
      ? "Service d'enrichissement Manus non configuré (MANUS_API_KEY manquante en secrets Supabase). Contactez l'administrateur."
      : "Manus API a échoué. L'enrichissement a été marqué comme échoué — aucun contact créé. Réessayez plus tard ou contactez le support.";

    return new Response(
      JSON.stringify({
        error: failureMessage,
        enrichment_id: enrichmentId,
        signal_id,
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Manus Enrichment] Error:", error instanceof Error ? error.message : error);

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

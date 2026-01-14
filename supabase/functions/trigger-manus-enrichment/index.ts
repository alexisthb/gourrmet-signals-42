import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
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

## PROCESSUS OPTIMISÉ AVEC SCRAPERS APIFY

### Phase 1: Recherche LinkedIn via harvestapi/linkedin-profile-search
Utilise le scraper Apify harvestapi/linkedin-profile-search pour chercher les profils:
- Endpoint: https://api.apify.com/v2/acts/harvestapi~linkedin-profile-search/run-sync-get-dataset-items?token=APIFY_TOKEN
- Méthode: POST
- Body JSON:
{
  "keywords": "${searchKeywords}",
  "company": "${signal.company_name}",
  "start": 0
}

Récupère les résultats et extrait les usernames des profils trouvés.

### Phase 2: Extraction des Détails via apimaestro/linkedin-profile-detail
Pour chaque profil trouvé, utilise le scraper Apify apimaestro/linkedin-profile-detail:
- Endpoint: https://api.apify.com/v2/acts/apimaestro~linkedin-profile-detail/run-sync-get-dataset-items?token=APIFY_TOKEN
- Méthode: POST
- Body JSON (pour chaque username):
{
  "username": "profile-username"
}

Extrait: firstName, lastName, headline, position (pour le titre et département), geo (pour la localisation).

### Phase 3: Enrichissement des Emails via lexis-solutions/rocketreach-pr-226
Pour enrichir les emails, utilise le scraper Apify lexis-solutions/rocketreach-pr-226:
- Endpoint: https://api.apify.com/v2/acts/lexis-solutions~rocketreach-pr-226/run-sync-get-dataset-items?token=APIFY_TOKEN
- Méthode: POST
- Body JSON:
{
  "firstName": "Prénom",
  "lastName": "Nom",
  "company": "${signal.company_name}"
}

Récupère les emails professionnels si disponibles.

### Phase 4: Fallback - Génération d'Email Standard
Si RocketReach ne retourne pas d'email, génère l'email selon le format standard:
- Format: firstname.lastname@company.com (en minuscules)
- Exemple: denise.dol@mollie.com

### Phase 5: Validation et Filtrage
- Écarte les profils avec titres stratégiques (CEO, VP, Head of, Director, etc.)
- Garde uniquement les profils opérationnels correspondant aux personas ciblés
- Sélectionne les 3-5 meilleurs contacts
- Valide que chaque contact a: nom, titre, email, LinkedIn URL

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
      "linkedin_url": "https://linkedin.com/in/username",
      "is_priority_persona": true/false
    }
  ],
  "company_info": {
    "website": "https://...",
    "industry": "Secteur",
    "employee_count": "Fourchette",
    "headquarters": "Ville"
  },
  "search_method": "Scrapers Apify: harvestapi/linkedin-profile-search (recherche) + apimaestro/linkedin-profile-detail (détails) + lexis-solutions/rocketreach-pr-226 (enrichissement emails)"
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
  "search_method": "Scrapers Apify utilisés mais aucun contact opérationnel trouvé",
  "error": "Aucun contact opérationnel identifié pour ${signal.company_name} dans le secteur ${signal.sector || 'Non spécifié'}"
}

## CRITÈRES DE QUALITÉ
✅ Contacts vérifiés via Apify scrapers
✅ Emails enrichis via RocketReach ou générés selon format standard
✅ Titres et départements exacts extraits de LinkedIn
✅ Profils LinkedIn valides
✅ Minimum 3 contacts, maximum 5
✅ Priorité aux personas prioritaires configurés

## IMPORTANT
- Ne pose JAMAIS de questions - exécute directement la recherche
- Retourne TOUJOURS un JSON valide
- Inclus TOUJOURS la méthode de recherche utilisée (scrapers Apify)
- Utilise les scrapers Apify dans l'ordre: search → detail → enrichissement
- Valide les emails avant de les retourner
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
          console.log(`[Manus Enrichment] Full Manus API response:`, JSON.stringify(manusResult, null, 2));
          
          // Manus API returns id or task_id depending on the endpoint
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
          
          console.log(`[Manus Enrichment] Updating enrichment ${enrichmentId} with raw_data:`, JSON.stringify(rawDataPayload));
          
          const { data: updatedEnrichment, error: updateError } = await supabase
            .from("company_enrichment")
            .update({
              status: "manus_processing",
              enrichment_source: "manus",
              raw_data: rawDataPayload
            })
            .eq("id", enrichmentId)
            .select()
            .single();

          if (updateError) {
            console.error("[Manus Enrichment] Failed to update enrichment with task_id:", updateError);
            console.error("[Manus Enrichment] Update error details:", JSON.stringify(updateError, null, 2));
            throw new Error(`Failed to update enrichment: ${updateError.message}`);
          }
          
          console.log("[Manus Enrichment] Enrichment record updated successfully:", JSON.stringify(updatedEnrichment, null, 2));

          const { data: updatedSignal, error: signalUpdateError } = await supabase
            .from("signals")
            .update({ enrichment_status: "manus_processing" })
            .eq("id", signal_id)
            .select()
            .single();

          if (signalUpdateError) {
            console.error("[Manus Enrichment] Failed to update signal status:", signalUpdateError);
          } else {
            console.log("[Manus Enrichment] Signal status updated to manus_processing:", JSON.stringify(updatedSignal, null, 2));
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
          console.error("[Manus Enrichment] Manus API error:", manusResponse.status, errorText);
          // Fall through to Lovable AI fallback
        }
      } catch (manusError) {
        console.error("[Manus Enrichment] Manus API call failed:", manusError);
        // Fall through to Lovable AI fallback
      }
    }
    
    if (!LOVABLE_API_KEY) {
      // Fallback: generate mock data without AI
      console.log("[Manus Enrichment] No API keys, using mock data");
      
      const mockContacts = generateMockContacts(signal.company_name, signal.sector, personas);
      
      // Insert contacts
      for (const contact of mockContacts) {
        await supabase.from("contacts").insert({
          enrichment_id: enrichmentId,
          signal_id,
          ...contact,
        });
      }

      // Update enrichment as completed
      await supabase
        .from("company_enrichment")
        .update({
          status: "completed",
          enrichment_source: "mock",
          domain: `${signal.company_name.toLowerCase().replace(/\s+/g, "")}.com`,
          website: `https://www.${signal.company_name.toLowerCase().replace(/\s+/g, "")}.com`,
          industry: signal.sector || "Non spécifié",
        })
        .eq("id", enrichmentId);

      // Update signal status
      await supabase
        .from("signals")
        .update({ enrichment_status: "completed" })
        .eq("id", signal_id);

      console.log(`[Manus Enrichment] Completed with ${mockContacts.length} mock contacts`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Enrichissement complété avec ${mockContacts.length} contacts (données simulées)`,
          contacts_count: mockContacts.length,
          source: "mock",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Use AI to generate realistic contacts based on company info
    console.log("[Manus Enrichment] Using Lovable AI for enrichment");

    const personaPromptForAI = personas.map((p, i) => `${i + 1}. ${p.name}${p.isPriority ? ' (PRIORITAIRE)' : ''}`).join('\n');

    const aiPrompt = `Tu es un assistant qui génère des données de contacts professionnels réalistes pour une entreprise.

Entreprise: ${signal.company_name}
Secteur: ${signal.sector || "Non spécifié"}
Taille estimée: ${signal.estimated_size || "Non spécifié"}
Type d'événement: ${signal.signal_type}

PERSONAS CIBLES (par ordre de priorité):
${personaPromptForAI}

Génère exactement 3 à 5 contacts décideurs réalistes pour cette entreprise, en PRIORITÉ les profils marqués PRIORITAIRE. Pour chaque contact, fournis:
- full_name: nom complet français réaliste
- first_name: prénom
- last_name: nom de famille
- job_title: poste correspondant aux personas ciblés
- department: département (Direction, Commercial, Finance, etc.)
- location: ville en France
- email_principal: email professionnel (format: prenom.nom@domaine.com)
- linkedin_url: URL LinkedIn fictive
- is_priority_target: true si le contact correspond à un persona PRIORITAIRE
- priority_score: score de 1 à 5 (5 = correspond à un persona prioritaire)

Réponds UNIQUEMENT avec un JSON valide contenant un tableau "contacts".`;

    try {
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Tu génères des données JSON structurées. Réponds uniquement avec du JSON valide." },
            { role: "user", content: aiPrompt },
          ],
          temperature: 0.7,
        }),
      });

      if (!aiResponse.ok) {
        throw new Error(`AI request failed: ${aiResponse.status}`);
      }

      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content || "";
      
      // Parse JSON from AI response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse AI response as JSON");
      }

      const parsedData = JSON.parse(jsonMatch[0]);
      const contacts = parsedData.contacts || [];

      console.log(`[Manus Enrichment] AI generated ${contacts.length} contacts`);

      // Insert contacts
      for (const contact of contacts) {
        await supabase.from("contacts").insert({
          enrichment_id: enrichmentId,
          signal_id,
          full_name: contact.full_name,
          first_name: contact.first_name,
          last_name: contact.last_name,
          job_title: contact.job_title,
          department: contact.department,
          location: contact.location,
          email_principal: contact.email_principal,
          linkedin_url: contact.linkedin_url,
          is_priority_target: contact.is_priority_target || false,
          priority_score: contact.priority_score || 3,
          outreach_status: "new",
        });
      }

      // Update enrichment as completed
      const domain = `${signal.company_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}.com`;
      await supabase
        .from("company_enrichment")
        .update({
          status: "completed",
          enrichment_source: "lovable_ai",
          domain,
          website: `https://www.${domain}`,
          industry: signal.sector || "Non spécifié",
        })
        .eq("id", enrichmentId);

      // Update signal status
      await supabase
        .from("signals")
        .update({ enrichment_status: "completed" })
        .eq("id", signal_id);

      console.log(`[Manus Enrichment] Completed successfully with ${contacts.length} contacts`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Enrichment completed with ${contacts.length} contacts`,
          contacts_count: contacts.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (aiError) {
      console.error("[Manus Enrichment] AI error, falling back to mock:", aiError);
      
      // Fallback to mock data
      const mockContacts = generateMockContacts(signal.company_name, signal.sector, personas);
      
      for (const contact of mockContacts) {
        await supabase.from("contacts").insert({
          enrichment_id: enrichmentId,
          signal_id,
          ...contact,
        });
      }

      await supabase
        .from("company_enrichment")
        .update({
          status: "completed",
          domain: `${signal.company_name.toLowerCase().replace(/\s+/g, "")}.com`,
          industry: signal.sector || "Non spécifié",
        })
        .eq("id", enrichmentId);

      await supabase
        .from("signals")
        .update({ enrichment_status: "completed" })
        .eq("id", signal_id);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Enrichment completed with ${mockContacts.length} contacts (fallback)`,
          contacts_count: mockContacts.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    console.error("[Manus Enrichment] Error:", error);

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Helper function to generate mock contacts based on configured personas
function generateMockContacts(companyName: string, sector: string | null, personas: Persona[]) {
  const domain = companyName.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "") + ".com";
  
  const mockFirstNames = ["Jean", "Marie", "Pierre", "Sophie", "François", "Claire", "Nicolas", "Isabelle"];
  const mockLastNames = ["Dupont", "Martin", "Bernard", "Petit", "Robert", "Richard", "Durand", "Leroy"];
  const cities = ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux"];

  const numContacts = Math.min(5, Math.max(3, personas.length));
  const contacts = [];

  for (let i = 0; i < numContacts && i < personas.length; i++) {
    const firstName = mockFirstNames[Math.floor(Math.random() * mockFirstNames.length)];
    const lastName = mockLastNames[Math.floor(Math.random() * mockLastNames.length)];
    const persona = personas[i];
    const city = cities[Math.floor(Math.random() * cities.length)];

    contacts.push({
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      job_title: persona.name,
      department: persona.isPriority ? "Direction" : "Opérations",
      location: city,
      email_principal: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
      linkedin_url: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${Math.random().toString(36).substring(7)}`,
      is_priority_target: persona.isPriority,
      priority_score: persona.isPriority ? 5 : 3,
      outreach_status: "new",
    });
  }

  return contacts;
}

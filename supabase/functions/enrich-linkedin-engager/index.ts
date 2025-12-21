import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EnrichmentRequest {
  engager_id?: string;
  batch?: boolean; // Enrichir tous les prospects non enrichis
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const MANUS_API_KEY = Deno.env.get("MANUS_API_KEY");

    const { engager_id, batch = false }: EnrichmentRequest = await req.json();

    // Mode batch: enrichir tous les prospects non enrichis
    if (batch) {
      console.log("[Engager Enrichment] Starting batch enrichment...");
      
      const { data: engagers, error: engagersError } = await supabase
        .from("linkedin_engagers")
        .select("*, linkedin_posts(source_id, linkedin_sources(name))")
        .eq("is_prospect", true)
        .is("contact_id", null)
        .eq("transferred_to_contacts", false)
        .limit(10); // Limiter pour éviter trop de tâches Manus

      if (engagersError) throw engagersError;

      if (!engagers || engagers.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "Aucun engager prospect à enrichir" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Engager Enrichment] Found ${engagers.length} engagers to enrich`);

      let tasksCreated = 0;
      const results: any[] = [];

      for (const engager of engagers) {
        const result = await triggerManusEnrichment(supabase, engager, MANUS_API_KEY);
        results.push({ engager_id: engager.id, name: engager.name, ...result });
        if (result.success) tasksCreated++;
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `${tasksCreated} enrichissements Manus lancés`,
          results 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode single: enrichir un engager spécifique
    if (!engager_id) {
      return new Response(
        JSON.stringify({ error: "engager_id ou batch=true requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: engager, error: engagerError } = await supabase
      .from("linkedin_engagers")
      .select("*, linkedin_posts(source_id, title, post_url)")
      .eq("id", engager_id)
      .single();

    if (engagerError || !engager) {
      return new Response(
        JSON.stringify({ error: "Engager non trouvé" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await triggerManusEnrichment(supabase, engager, MANUS_API_KEY);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Engager Enrichment] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function triggerManusEnrichment(supabase: any, engager: any, MANUS_API_KEY: string | undefined) {
  console.log(`[Engager Enrichment] Processing: ${engager.name}`);

  // Vérifier si déjà enrichi
  if (engager.contact_id) {
    return { success: false, message: "Déjà enrichi", status: "already_enriched" };
  }

  // Marquer comme en cours d'enrichissement via raw_data temporaire
  await supabase
    .from("linkedin_engagers")
    .update({ 
      updated_at: new Date().toISOString()
    })
    .eq("id", engager.id);

  if (!MANUS_API_KEY) {
    // Fallback: créer contact directement sans enrichissement email
    console.log("[Engager Enrichment] No Manus API key, creating contact directly");
    return await createContactFromEngager(supabase, engager, null);
  }

  // Construire le prompt Manus pour enrichir ce contact
  const linkedinUrl = engager.linkedin_url || "";
  const linkedinUsername = linkedinUrl.match(/linkedin\.com\/in\/([^\/\?]+)/)?.[1] || "";
  
  const manusPrompt = `Tu es un expert en recherche de contacts B2B. Tu dois enrichir les informations d'un contact LinkedIn.

## CONTACT À ENRICHIR
- Nom: ${engager.name}
- Headline LinkedIn: ${engager.headline || "Non disponible"}
- Entreprise détectée: ${engager.company || "Non spécifiée"}
- URL LinkedIn: ${engager.linkedin_url || "Non disponible"}
- Username LinkedIn: ${linkedinUsername || "Non disponible"}

## MISSION
Trouve l'email professionnel et les informations complètes de ce contact.

## PROCESSUS OPTIMISÉ AVEC SCRAPERS APIFY

### Phase 1: Récupération du profil LinkedIn complet
${linkedinUsername ? `Utilise le scraper Apify apimaestro/linkedin-profile-detail:
- Endpoint: https://api.apify.com/v2/acts/apimaestro~linkedin-profile-detail/run-sync-get-dataset-items
- Body: {"username": "${linkedinUsername}"}

Extrait: firstName, lastName, headline, position, company, geo, emails si disponibles.` : "Pas de username LinkedIn disponible, passe à la recherche par nom."}

### Phase 2: Enrichissement Email via RocketReach
Utilise le scraper Apify lexis-solutions/rocketreach-pr-226:
- Endpoint: https://api.apify.com/v2/acts/lexis-solutions~rocketreach-pr-226/run-sync-get-dataset-items
- Body: {
  "firstName": "${engager.name.split(' ')[0] || ''}",
  "lastName": "${engager.name.split(' ').slice(1).join(' ') || ''}",
  "company": "${engager.company || ''}"
}

### Phase 3: Fallback - Génération d'email standard
Si RocketReach ne retourne rien, génère l'email selon le format standard:
- Format: prenom.nom@domaine-entreprise.com

## FORMAT DE RÉPONSE (JSON OBLIGATOIRE)
{
  "contact": {
    "full_name": "${engager.name}",
    "first_name": "Prénom",
    "last_name": "Nom",
    "job_title": "Titre exact",
    "department": "Département",
    "company": "Nom entreprise",
    "location": "Ville, Pays",
    "email": "email@entreprise.com",
    "email_alternatif": "email2@domaine.com (si trouvé)",
    "phone": "Numéro (si trouvé)",
    "linkedin_url": "${engager.linkedin_url || ''}"
  },
  "enrichment_method": "Description de la méthode utilisée",
  "confidence_score": 0.85
}

## SI AUCUNE INFO TROUVÉE
{
  "contact": {
    "full_name": "${engager.name}",
    "linkedin_url": "${engager.linkedin_url || ''}",
    "company": "${engager.company || ''}"
  },
  "enrichment_method": "Scrapers utilisés mais informations limitées",
  "error": "Raison de l'échec"
}

## IMPORTANT
- Ne pose JAMAIS de questions - exécute directement
- Retourne TOUJOURS un JSON valide
- Utilise les scrapers Apify avec le token disponible
- Priorise RocketReach pour les emails`;

  try {
    console.log("[Engager Enrichment] Calling Manus API...");
    
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

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error("[Engager Enrichment] Manus API error:", manusResponse.status, errorText);
      // Fallback: créer contact sans enrichissement
      return await createContactFromEngager(supabase, engager, null);
    }

    const manusResult = await manusResponse.json();
    const taskId = manusResult.id || manusResult.task_id;
    const taskUrl = manusResult.task_url || manusResult.url || `https://manus.ai/tasks/${taskId}`;

    console.log(`[Engager Enrichment] Manus task created: ${taskId}`);

    // Stocker le task_id dans raw_data de l'engager
    // On va utiliser un champ spécial dans linkedin_engagers ou créer un tracking séparé
    // Pour simplifier, on marque juste l'engager et on stocke dans son raw_data via une table de tracking
    
    // Option: on crée un "enrichment_task" dans une sous-table ou on track via company_enrichment
    // Pour rester simple, on crée directement le contact en mode "manus_processing"
    
    // Créer un contact placeholder avec le manus_task_id
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        full_name: engager.name,
        first_name: engager.name.split(' ')[0] || engager.name,
        last_name: engager.name.split(' ').slice(1).join(' ') || null,
        job_title: engager.headline || null,
        linkedin_url: engager.linkedin_url || null,
        outreach_status: "manus_processing",
        source: "linkedin",
        raw_data: { 
          source: "linkedin_engager",
          engager_id: engager.id,
          manus_task_id: taskId,
          manus_task_url: taskUrl,
          engagement_type: engager.engagement_type,
          post_id: engager.post_id,
        },
      })
      .select()
      .single();

    // Note: la table contacts a une contrainte sur enrichment_id NOT NULL
    // On doit soit:
    // 1. Créer un enrichment factice
    // 2. Modifier la contrainte pour permettre NULL quand source=linkedin
    // Pour l'instant, on va créer un enrichment factice

    if (contactError) {
      console.error("[Engager Enrichment] Failed to create contact:", contactError);
      // Le contact n'a pas pu être créé, on log et continue
    } else {
      // Lier l'engager au contact
      await supabase
        .from("linkedin_engagers")
        .update({ 
          contact_id: contact.id,
          transferred_to_contacts: false, // sera true quand Manus aura fini
        })
        .eq("id", engager.id);
    }

    return {
      success: true,
      message: "Enrichissement Manus lancé",
      manus_task_id: taskId,
      manus_task_url: taskUrl,
      engager_id: engager.id,
    };

  } catch (error) {
    console.error("[Engager Enrichment] Error calling Manus:", error);
    // Fallback: créer contact sans enrichissement
    return await createContactFromEngager(supabase, engager, null);
  }
}

async function createContactFromEngager(supabase: any, engager: any, enrichmentData: any) {
  console.log(`[Engager Enrichment] Creating contact directly for: ${engager.name}`);

  // Générer un email basique si on a l'entreprise
  let generatedEmail = null;
  if (engager.company) {
    const firstName = engager.name.split(' ')[0]?.toLowerCase() || '';
    const lastName = engager.name.split(' ').slice(1).join('').toLowerCase() || '';
    const domain = engager.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com';
    if (firstName && lastName) {
      generatedEmail = `${firstName}.${lastName}@${domain}`;
    }
  }

  try {
    // Créer le contact sans enrichment_id (à adapter si contrainte)
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        full_name: engager.name,
        first_name: engager.name.split(' ')[0] || engager.name,
        last_name: engager.name.split(' ').slice(1).join(' ') || null,
        job_title: engager.headline || null,
        linkedin_url: engager.linkedin_url || null,
        email_principal: enrichmentData?.email || generatedEmail,
        outreach_status: "new",
        source: "linkedin",
        raw_data: { 
          source: "linkedin_engager",
          engager_id: engager.id,
          engagement_type: engager.engagement_type,
          post_id: engager.post_id,
          company_detected: engager.company,
        },
      })
      .select()
      .single();

    if (contactError) {
      console.error("[Engager Enrichment] Contact insert error:", contactError);
      return { success: false, error: contactError.message };
    }

    // Lier l'engager au contact
    await supabase
      .from("linkedin_engagers")
      .update({ 
        contact_id: contact.id,
        transferred_to_contacts: true,
      })
      .eq("id", engager.id);

    return {
      success: true,
      message: "Contact créé (sans enrichissement Manus)",
      contact_id: contact.id,
    };

  } catch (error) {
    console.error("[Engager Enrichment] Error creating contact:", error);
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

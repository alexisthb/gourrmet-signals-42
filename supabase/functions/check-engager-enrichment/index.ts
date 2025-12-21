import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const manusApiKey = Deno.env.get("MANUS_API_KEY");

    const { contact_id, batch = false } = await req.json();

    // Mode batch: vérifier tous les contacts LinkedIn en attente
    if (batch) {
      console.log("[Check Engager] Starting batch check...");
      
      const { data: pendingContacts, error } = await supabase
        .from("contacts")
        .select("*")
        .eq("source", "linkedin")
        .eq("outreach_status", "manus_processing");

      if (error) throw error;

      if (!pendingContacts || pendingContacts.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: "Aucun contact en attente" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Check Engager] Found ${pendingContacts.length} contacts to check`);

      let completed = 0;
      let stillProcessing = 0;
      const results: any[] = [];

      for (const contact of pendingContacts) {
        const result = await checkContactEnrichment(supabase, contact, manusApiKey);
        results.push({ contact_id: contact.id, name: contact.full_name, ...result });
        if (result.status === "completed") completed++;
        else stillProcessing++;
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          completed,
          still_processing: stillProcessing,
          results 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mode single
    if (!contact_id) {
      return new Response(
        JSON.stringify({ error: "contact_id ou batch=true requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contact_id)
      .single();

    if (contactError || !contact) {
      return new Response(
        JSON.stringify({ error: "Contact non trouvé" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await checkContactEnrichment(supabase, contact, manusApiKey);
    
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[Check Engager] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function checkContactEnrichment(supabase: any, contact: any, manusApiKey: string | undefined) {
  const rawData = contact.raw_data as any;
  const manusTaskId = rawData?.manus_task_id;

  if (!manusTaskId) {
    return { status: contact.outreach_status, message: "Pas de tâche Manus associée" };
  }

  if (!manusApiKey) {
    return { status: "error", message: "MANUS_API_KEY non configurée" };
  }

  console.log(`[Check Engager] Checking Manus task: ${manusTaskId} for ${contact.full_name}`);

  try {
    const manusResponse = await fetch(`https://api.manus.ai/v1/tasks/${manusTaskId}`, {
      method: "GET",
      headers: {
        "API_KEY": manusApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!manusResponse.ok) {
      console.error(`[Check Engager] Manus API error: ${manusResponse.status}`);
      return { status: "manus_processing", message: "Impossible de vérifier le statut Manus" };
    }

    const taskData = await manusResponse.json();
    console.log(`[Check Engager] Manus task status: ${taskData.status}`);

    if (taskData.status !== "completed") {
      return { 
        status: "manus_processing", 
        manus_status: taskData.status,
        message: `Manus ${taskData.status === "running" ? "en cours" : taskData.status}` 
      };
    }

    // Tâche terminée - extraire les données
    const enrichmentData = extractContactFromManusOutput(taskData);
    
    // Mettre à jour le contact avec les données enrichies
    const updateData: any = {
      outreach_status: "new",
      updated_at: new Date().toISOString(),
      raw_data: {
        ...rawData,
        manus_output: taskData.output,
        enrichment_completed_at: new Date().toISOString(),
      },
    };

    if (enrichmentData.email) {
      updateData.email_principal = enrichmentData.email;
    }
    if (enrichmentData.email_alternatif) {
      updateData.email_alternatif = enrichmentData.email_alternatif;
    }
    if (enrichmentData.phone) {
      updateData.phone = enrichmentData.phone;
    }
    if (enrichmentData.job_title) {
      updateData.job_title = enrichmentData.job_title;
    }
    if (enrichmentData.department) {
      updateData.department = enrichmentData.department;
    }
    if (enrichmentData.location) {
      updateData.location = enrichmentData.location;
    }
    if (enrichmentData.first_name) {
      updateData.first_name = enrichmentData.first_name;
    }
    if (enrichmentData.last_name) {
      updateData.last_name = enrichmentData.last_name;
    }

    await supabase
      .from("contacts")
      .update(updateData)
      .eq("id", contact.id);

    // Marquer l'engager comme transféré
    const engagerId = rawData?.engager_id;
    if (engagerId) {
      await supabase
        .from("linkedin_engagers")
        .update({ transferred_to_contacts: true })
        .eq("id", engagerId);
    }

    console.log(`[Check Engager] Contact ${contact.full_name} enriched with email: ${enrichmentData.email || 'N/A'}`);

    return {
      status: "completed",
      email_found: !!enrichmentData.email,
      email: enrichmentData.email,
      message: enrichmentData.email 
        ? `Email trouvé: ${enrichmentData.email}` 
        : "Enrichissement terminé (pas d'email trouvé)",
    };

  } catch (error) {
    console.error("[Check Engager] Error checking Manus:", error);
    return { status: "error", message: error instanceof Error ? error.message : "Erreur inconnue" };
  }
}

function extractContactFromManusOutput(taskData: any): any {
  const output = taskData.output;
  
  const tryParseJson = (text: string): any => {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {}
    return null;
  };

  // Si output est un tableau de messages (format standard Manus)
  if (Array.isArray(output)) {
    for (const message of output) {
      if (message?.role === "assistant") {
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const block of content) {
          // Chercher dans output_file
          if (block?.type === "output_file") {
            const fileUrl = block?.fileUrl || block?.file_url;
            // On ne peut pas fetch ici de manière synchrone, on va ignorer les fichiers
          }
          // Chercher dans output_text
          if (block?.type === "output_text" && typeof block?.text === "string") {
            const parsed = tryParseJson(block.text);
            if (parsed?.contact) return parsed.contact;
          }
        }
      }
    }
  }

  // Si output est une string JSON
  if (typeof output === "string") {
    const parsed = tryParseJson(output);
    if (parsed?.contact) return parsed.contact;
    return parsed || {};
  }

  // Si output est un objet direct
  if (typeof output === "object" && output) {
    if (output.contact) return output.contact;
    return output;
  }

  return {};
}

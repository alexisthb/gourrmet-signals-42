import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { signal_id } = await req.json();

    if (!signal_id) {
      return new Response(
        JSON.stringify({ error: "signal_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the enrichment record to find the manus_task_id
    const { data: enrichment, error: enrichmentError } = await supabase
      .from("company_enrichment")
      .select("*")
      .eq("signal_id", signal_id)
      .single();

    if (enrichmentError || !enrichment) {
      console.error("Enrichment not found:", enrichmentError);
      return new Response(
        JSON.stringify({ error: "Enrichment record not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if raw_data contains manus_task_id
    const rawData = enrichment.raw_data as { manus_task_id?: string; manus_task_url?: string } | null;
    const manusTaskId = rawData?.manus_task_id;

    if (!manusTaskId) {
      return new Response(
        JSON.stringify({ 
          status: enrichment.status,
          message: "No Manus task ID found - enrichment may not be using Manus"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check Manus API for task status
    const manusApiKey = Deno.env.get("MANUS_API_KEY");
    if (!manusApiKey) {
      return new Response(
        JSON.stringify({ error: "MANUS_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Checking Manus task status for task_id: ${manusTaskId}`);

    const manusResponse = await fetch(`https://api.manus.ai/v1/tasks/${manusTaskId}`, {
      method: "GET",
      headers: {
        // Manus API expects API_KEY (same as task creation)
        "API_KEY": manusApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!manusResponse.ok) {
      const errorText = await manusResponse.text();
      console.error(`Manus API error: ${manusResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ 
          status: "manus_processing",
          message: "Unable to check Manus status",
          manus_task_id: manusTaskId,
          manus_task_url: rawData?.manus_task_url
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const taskData = await manusResponse.json();
    console.log("Manus task status:", JSON.stringify(taskData, null, 2));

    // If task is still running, return current status
    if (taskData.status !== "completed") {
      return new Response(
        JSON.stringify({ 
          status: "manus_processing",
          manus_status: taskData.status,
          manus_task_id: manusTaskId,
          manus_task_url: rawData?.manus_task_url,
          message: `Manus is ${taskData.status === "running" ? "still processing" : taskData.status}`
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Task is completed - extract contacts from Manus output
    console.log("Manus task completed, extracting contacts...");

    let contacts: any[] = [];
    let manusOutputFileUrl: string | null = null;

    const extractContactsFromObject = (obj: any): any[] => {
      if (!obj) return [];
      if (Array.isArray(obj)) return obj;
      if (obj.contacts && Array.isArray(obj.contacts)) return obj.contacts;
      if (obj.data?.contacts && Array.isArray(obj.data.contacts)) return obj.data.contacts;
      return [];
    };

    const tryParseJsonFromText = (text: string): any[] => {
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return [];
        const parsed = JSON.parse(match[0]);
        return extractContactsFromObject(parsed);
      } catch {
        return [];
      }
    };

    if (taskData.output) {
      // 1) output as JSON string
      if (typeof taskData.output === "string") {
        try {
          const parsed = JSON.parse(taskData.output);
          contacts = extractContactsFromObject(parsed);
        } catch {
          contacts = tryParseJsonFromText(taskData.output);
        }
      }

      // 2) output as object
      if (!contacts.length && typeof taskData.output === "object" && !Array.isArray(taskData.output)) {
        contacts = extractContactsFromObject(taskData.output);
      }

      // 3) Manus agent format: output is an array of messages with content blocks
      if (Array.isArray(taskData.output)) {
        for (const message of taskData.output) {
          if (!message?.content || !Array.isArray(message.content)) continue;

          for (const block of message.content) {
            if (block?.type === "output_file" && block?.fileUrl) {
              const isJson =
                (typeof block?.mimeType === "string" && block.mimeType.includes("json")) ||
                (typeof block?.fileName === "string" && block.fileName.toLowerCase().endsWith(".json"));

              if (isJson) {
                manusOutputFileUrl = String(block.fileUrl);
              }
            }

            if (block?.type === "output_text" && typeof block?.text === "string" && !contacts.length) {
              const extracted = tryParseJsonFromText(block.text);
              if (extracted.length) contacts = extracted;
            }
          }
        }
      }
    }

    // If Manus provided a JSON file, download it and parse contacts
    if (manusOutputFileUrl && contacts.length === 0) {
      console.log("Found Manus output JSON file, downloading...", manusOutputFileUrl);
      try {
        const fileResp = await fetch(manusOutputFileUrl);
        if (!fileResp.ok) {
          const t = await fileResp.text();
          throw new Error(`Failed to download Manus output file: ${fileResp.status} ${t}`);
        }
        const fileJson = await fileResp.json();
        contacts = extractContactsFromObject(fileJson);
      } catch (e) {
        console.error("Failed to fetch/parse Manus output file:", e);
      }
    }

    // If we got contacts, replace previous ones for this enrichment and insert
    if (contacts.length > 0) {
      const { error: deleteError } = await supabase
        .from("contacts")
        .delete()
        .eq("enrichment_id", enrichment.id);

      if (deleteError) {
        console.error("Error deleting previous contacts:", deleteError);
      }

      const contactsToInsert = contacts.map((contact: any, index: number) => ({
        enrichment_id: enrichment.id,
        signal_id: signal_id,
        full_name: contact.full_name || contact.name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || `Contact ${index + 1}`,
        first_name: contact.first_name || null,
        last_name: contact.last_name || null,
        job_title: contact.job_title || contact.title || null,
        department: contact.department || null,
        email_principal: contact.email || contact.email_principal || null,
        email_alternatif: contact.email_alternatif || null,
        phone: contact.phone || null,
        linkedin_url: contact.linkedin_url || contact.linkedin || null,
        location: contact.location || null,
        is_priority_target: index < 3,
        // priority_score is constrained in DB (1-5)
        priority_score: Math.max(1, 5 - index),
        outreach_status: "new",
        raw_data: contact,
      }));

      const { error: contactsError } = await supabase
        .from("contacts")
        .insert(contactsToInsert);

      if (contactsError) {
        console.error("Error inserting contacts:", contactsError);
      } else {
        console.log(`Inserted ${contactsToInsert.length} contacts from Manus`);
      }
    } else {
      console.log("No contacts extracted from Manus output");
    }

    // Update enrichment status to completed
    await supabase
      .from("company_enrichment")
      .update({
        status: "completed",
        raw_data: { ...rawData, manus_output: taskData.output },
      })
      .eq("id", enrichment.id);

    // Update signal enrichment status
    await supabase
      .from("signals")
      .update({ enrichment_status: "completed" })
      .eq("id", signal_id);

    return new Response(
      JSON.stringify({
        status: "completed",
        contacts_count: contacts.length,
        manus_task_id: manusTaskId,
        message: `Enrichissement terminé avec ${contacts.length} contact(s)`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in check-manus-status:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

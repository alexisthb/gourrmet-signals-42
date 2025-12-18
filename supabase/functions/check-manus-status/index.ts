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
        "Authorization": `Bearer ${manusApiKey}`,
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

    // Task is completed - try to extract contacts from the output
    console.log("Manus task completed, extracting contacts...");
    
    let contacts: any[] = [];
    
    // Try to parse contacts from task output
    if (taskData.output) {
      try {
        // The output could be a string or already parsed
        const output = typeof taskData.output === "string" 
          ? JSON.parse(taskData.output) 
          : taskData.output;
        
        if (output.contacts && Array.isArray(output.contacts)) {
          contacts = output.contacts;
        } else if (Array.isArray(output)) {
          contacts = output;
        }
      } catch (parseError) {
        console.log("Could not parse structured output, will try text parsing");
        // If the output is plain text, we might need to parse it differently
      }
    }

    // If we got contacts, insert them
    if (contacts.length > 0) {
      const contactsToInsert = contacts.map((contact: any, index: number) => ({
        enrichment_id: enrichment.id,
        signal_id: signal_id,
        full_name: contact.full_name || contact.name || `Contact ${index + 1}`,
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
        priority_score: Math.max(0, 100 - (index * 10)),
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

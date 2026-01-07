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

    // Check Manus API for task status - try env first, then settings table
    let manusApiKey = Deno.env.get("MANUS_API_KEY");
    if (!manusApiKey) {
      const { data: setting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "manus_api_key")
        .single();
      manusApiKey = setting?.value || null;
    }
    if (!manusApiKey) {
      return new Response(
        JSON.stringify({ error: "MANUS_API_KEY not configured (neither in env nor settings)" }),
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
    let manusError: string | null = null;
    let companyInfo: any = null;
    let searchMethod: string | null = null;

    const looksLikeContact = (v: any) => {
      if (!v || typeof v !== "object") return false;
      return (
        typeof v.full_name === "string" ||
        typeof v.linkedin_url === "string" ||
        typeof v.job_title === "string" ||
        typeof v.email === "string" ||
        typeof v.email_principal === "string"
      );
    };

    const extractDataFromObject = (obj: any): { contacts: any[]; error: string | null; companyInfo: any; searchMethod: string | null } => {
      if (!obj) return { contacts: [], error: null, companyInfo: null, searchMethod: null };

      // Extract error if present
      const error = typeof obj?.error === "string" ? obj.error : null;
      
      // Extract company_info if present
      const company_info = obj?.company_info || null;
      
      // Extract search_method if present
      const search_method = typeof obj?.search_method === "string" ? obj.search_method : null;

      // Extract contacts - most common shapes
      let extractedContacts: any[] = [];
      
      const direct = obj?.contacts;
      if (Array.isArray(direct)) {
        extractedContacts = direct.filter(looksLikeContact);
      } else {
        const nestedData = obj?.data?.contacts;
        if (Array.isArray(nestedData)) {
          extractedContacts = nestedData.filter(looksLikeContact);
        } else {
          const nestedResult = obj?.result?.contacts;
          if (Array.isArray(nestedResult)) {
            extractedContacts = nestedResult.filter(looksLikeContact);
          } else if (Array.isArray(obj) && obj.some(looksLikeContact)) {
            extractedContacts = obj.filter(looksLikeContact);
          }
        }
      }

      return { contacts: extractedContacts, error, companyInfo: company_info, searchMethod: search_method };
    };

    const tryParseDataFromText = (text: string): { contacts: any[]; error: string | null; companyInfo: any; searchMethod: string | null } => {
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) return { contacts: [], error: null, companyInfo: null, searchMethod: null };
        const parsed = JSON.parse(match[0]);
        return extractDataFromObject(parsed);
      } catch {
        return { contacts: [], error: null, companyInfo: null, searchMethod: null };
      }
    };

    const output = taskData.output;

    // 1) If output is an array of Manus messages, prefer output_file JSON
    console.log(`Output is array: ${Array.isArray(output)}, length: ${output?.length || 0}`);
    if (Array.isArray(output)) {
      for (const message of output) {
        const role = message?.role;
        const content = Array.isArray(message?.content) ? message.content : [];
        console.log(`Message role: ${role}, content blocks: ${content.length}`);

        for (const block of content) {
          const fileUrl = block?.fileUrl || block?.file_url;
          console.log(`Block type: ${block?.type}, hasFileUrl: ${!!fileUrl}`);
          if (block?.type === "output_file" && fileUrl) {
            const fileName = String(block?.fileName || block?.file_name || "");
            const mimeType = String(block?.mimeType || block?.mime_type || "");
            const isJson = mimeType.includes("json") || fileName.toLowerCase().endsWith(".json");
            console.log(`Found output_file: ${fileName}, isJson: ${isJson}`);
            if (isJson) manusOutputFileUrl = String(fileUrl);
          }

          // Fallback: try parse assistant text (avoid parsing the USER prompt JSON schema)
          if (!contacts.length && role === "assistant" && block?.type === "output_text" && typeof block?.text === "string") {
            const extracted = tryParseDataFromText(block.text);
            if (extracted.contacts.length) contacts = extracted.contacts;
            if (extracted.error) manusError = extracted.error;
            if (extracted.companyInfo) companyInfo = extracted.companyInfo;
            if (extracted.searchMethod) searchMethod = extracted.searchMethod;
          }
        }
      }
    }

    // 2) Other formats
    if (!Array.isArray(output)) {
      if (typeof output === "string") {
        try {
          const parsed = JSON.parse(output);
          const extracted = extractDataFromObject(parsed);
          contacts = extracted.contacts;
          manusError = extracted.error;
          companyInfo = extracted.companyInfo;
          searchMethod = extracted.searchMethod;
        } catch {
          const extracted = tryParseDataFromText(output);
          contacts = extracted.contacts;
          manusError = extracted.error;
          companyInfo = extracted.companyInfo;
          searchMethod = extracted.searchMethod;
        }
      } else if (typeof output === "object" && output) {
        const extracted = extractDataFromObject(output);
        contacts = extracted.contacts;
        manusError = extracted.error;
        companyInfo = extracted.companyInfo;
        searchMethod = extracted.searchMethod;
      }
    }

    // 3) If Manus provided a JSON file, always try it and override contacts if it contains real contacts
    console.log(`manusOutputFileUrl found: ${!!manusOutputFileUrl}`);
    if (manusOutputFileUrl) {
      console.log("Found Manus output JSON file, downloading...");
      try {
        const fileResp = await fetch(manusOutputFileUrl);
        console.log(`File download status: ${fileResp.status}`);
        if (!fileResp.ok) {
          const t = await fileResp.text();
          throw new Error(`Failed to download Manus output file: ${fileResp.status} ${t}`);
        }
        const fileJson = await fileResp.json();
        console.log(`File JSON keys: ${Object.keys(fileJson).join(", ")}`);
        console.log(`File has contacts array: ${Array.isArray(fileJson?.contacts)}, length: ${fileJson?.contacts?.length || 0}`);
        const fileData = extractDataFromObject(fileJson);
        console.log(`extractDataFromObject returned ${fileData.contacts.length} contacts`);
        if (fileData.contacts.length) {
          contacts = fileData.contacts;
          console.log(`Parsed ${contacts.length} contacts from Manus output file`);
        }
        // Always take error/companyInfo/searchMethod from file if available
        if (fileData.error) manusError = fileData.error;
        if (fileData.companyInfo) companyInfo = fileData.companyInfo;
        if (fileData.searchMethod) searchMethod = fileData.searchMethod;
        
        if (!fileData.contacts.length) {
          console.log("Output file downloaded but no contacts found inside");
        }
      } catch (e) {
        console.error("Failed to fetch/parse Manus output file:", e);
      }
    }

    if (contacts.length === 0) {
      console.log("No contacts extracted from Manus output");
      if (manusError) {
        console.log("Manus error message:", manusError);
      }
    }
    
    if (searchMethod) {
      console.log("Manus search method:", searchMethod);
    }

    // Persist contacts in DB (needed for the UI)
    let insertedCount = 0;
    try {
      const { data: existingContacts, error: existingContactsError } = await supabase
        .from("contacts")
        .select("id")
        .eq("signal_id", signal_id)
        .limit(1);

      if (existingContactsError) {
        console.error("Failed to check existing contacts:", existingContactsError);
      }

      const hasAnyContacts = (existingContacts?.length ?? 0) > 0;

      if (!hasAnyContacts && contacts.length > 0) {
        const norm = (v: any) => (typeof v === "string" ? v.trim() : null);

        const deriveNames = (fullName: string | null) => {
          if (!fullName) return { first_name: null, last_name: null };
          const parts = fullName.split(/\s+/).filter(Boolean);
          if (parts.length <= 1) return { first_name: parts[0] ?? null, last_name: null };
          return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(" ") || null };
        };

        const getPriorityScore = (jobTitle: string | null) => {
          const t = (jobTitle || "").toLowerCase();
          if (
            t.includes("executive assistant") ||
            t.includes("assistant") ||
            t.includes("office manager") ||
            t.includes("workplace") ||
            t.includes("facility") ||
            t.includes("procurement") ||
            t.includes("purchas") ||
            t.includes("services gén")
          ) return 5;
          if (t.includes("admin") || t.includes("operations")) return 4;
          return 3;
        };

        const contactRows = contacts.map((c: any) => {
          const full_name = norm(c.full_name) || null;
          const fromFull = deriveNames(full_name);
          const first_name = norm(c.first_name) || fromFull.first_name;
          const last_name = norm(c.last_name) || fromFull.last_name;
          const job_title = norm(c.job_title) || null;
          const department = norm(c.department) || null;
          const location = norm(c.location) || null;
          const email_principal = norm(c.email_principal) || norm(c.email) || null;
          const email_alternatif = norm(c.email_alternatif) || null;
          const phone = norm(c.phone) || null;
          const linkedin_url = norm(c.linkedin_url) || null;
          const priority_score = typeof c.priority_score === "number" ? c.priority_score : getPriorityScore(job_title);
          const is_priority_target = typeof c.is_priority_target === "boolean" ? c.is_priority_target : priority_score >= 4;

          return {
            enrichment_id: enrichment.id,
            signal_id,
            full_name: full_name || [first_name, last_name].filter(Boolean).join(" ") || "Contact",
            first_name,
            last_name,
            job_title,
            department,
            location,
            email_principal,
            email_alternatif,
            phone,
            linkedin_url,
            is_priority_target,
            priority_score,
            outreach_status: "new",
            raw_data: { source: "manus", manus_task_id: manusTaskId },
          };
        });

        const { data: inserted, error: insertError } = await supabase
          .from("contacts")
          .insert(contactRows)
          .select("id");

        if (insertError) {
          console.error("Failed to insert contacts:", insertError);
          throw new Error(`Failed to insert contacts: ${insertError.message}`);
        }

        insertedCount = inserted?.length || 0;
        console.log(`Inserted ${insertedCount} contact(s) into DB`);
      } else {
        console.log("Contacts already exist or none extracted; skipping insert");
      }
    } catch (e) {
      console.error("Contact persistence error:", e);
      // We still continue to update statuses so the UI is not blocked; user can retry via UI recovery.
    }

    // Build enrichment update with all extracted data
    const enrichmentUpdate: any = {
      status: "completed",
      raw_data: { 
        ...rawData, 
        manus_output: taskData.output,
        search_method: searchMethod,
        manus_error: manusError,
      },
    };
    
    // Add company_info fields if available
    if (companyInfo) {
      if (companyInfo.website && companyInfo.website !== "N/A") {
        enrichmentUpdate.website = companyInfo.website;
      }
      if (companyInfo.industry && companyInfo.industry !== "N/A") {
        enrichmentUpdate.industry = companyInfo.industry;
      }
      if (companyInfo.employee_count && companyInfo.employee_count !== "N/A") {
        enrichmentUpdate.employee_count = companyInfo.employee_count;
      }
      if (companyInfo.headquarters && companyInfo.headquarters !== "N/A") {
        enrichmentUpdate.headquarters_location = companyInfo.headquarters;
      }
    }
    
    // If no contacts found and there's an error, store it
    if (contacts.length === 0 && manusError) {
      enrichmentUpdate.error_message = manusError;
    }

    // Update enrichment status to completed
    await supabase
      .from("company_enrichment")
      .update(enrichmentUpdate)
      .eq("id", enrichment.id);

    // Update signal enrichment status
    await supabase
      .from("signals")
      .update({ enrichment_status: "completed" })
      .eq("id", signal_id);

    // Build response message
    let responseMessage = `Enrichissement terminé avec ${contacts.length} contact(s)`;
    if (contacts.length === 0 && manusError) {
      responseMessage = manusError;
    }

    return new Response(
      JSON.stringify({
        status: "completed",
        contacts_count: contacts.length,
        inserted_count: insertedCount,
        manus_task_id: manusTaskId,
        manus_task_url: rawData?.manus_task_url,
        search_method: searchMethod,
        company_info: companyInfo,
        error: manusError,
        message: responseMessage,
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

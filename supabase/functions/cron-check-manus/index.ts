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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const manusApiKey = Deno.env.get("MANUS_API_KEY");

  if (!manusApiKey) {
    console.error("MANUS_API_KEY not configured");
    return new Response(
      JSON.stringify({ error: "MANUS_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("[Cron Check Manus] Starting batch check...");

  // Get all enrichments in manus_processing status
  const { data: processingEnrichments, error: fetchError } = await supabase
    .from("company_enrichment")
    .select("id, signal_id, company_name, raw_data, created_at")
    .eq("status", "manus_processing")
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("[Cron Check Manus] Failed to fetch enrichments:", fetchError);
    return new Response(
      JSON.stringify({ error: "Failed to fetch enrichments" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!processingEnrichments || processingEnrichments.length === 0) {
    console.log("[Cron Check Manus] No enrichments in processing state");
    return new Response(
      JSON.stringify({ message: "No enrichments to check", checked: 0, completed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log(`[Cron Check Manus] Found ${processingEnrichments.length} enrichments to check`);

  const results: { enrichment_id: string; company_name: string; status: string; contacts_count: number; error?: string }[] = [];

  // Process each enrichment
  for (const enrichment of processingEnrichments) {
    const rawData = enrichment.raw_data as { manus_task_id?: string; manus_task_url?: string } | null;
    const manusTaskId = rawData?.manus_task_id;

    if (!manusTaskId) {
      console.log(`[Cron Check Manus] No manus_task_id for ${enrichment.company_name}`);
      results.push({ 
        enrichment_id: enrichment.id, 
        company_name: enrichment.company_name, 
        status: "no_task_id", 
        contacts_count: 0 
      });
      continue;
    }

    try {
      console.log(`[Cron Check Manus] Checking ${enrichment.company_name} (task: ${manusTaskId})`);

      const manusResponse = await fetch(`https://api.manus.ai/v1/tasks/${manusTaskId}`, {
        method: "GET",
        headers: {
          "API_KEY": manusApiKey,
          "Content-Type": "application/json",
        },
      });

      if (!manusResponse.ok) {
        const errorText = await manusResponse.text();
        console.error(`[Cron Check Manus] Manus API error for ${enrichment.company_name}: ${manusResponse.status}`);
        results.push({ 
          enrichment_id: enrichment.id, 
          company_name: enrichment.company_name, 
          status: "api_error", 
          contacts_count: 0,
          error: errorText
        });
        continue;
      }

      const taskData = await manusResponse.json();
      
      if (taskData.status !== "completed") {
        console.log(`[Cron Check Manus] ${enrichment.company_name} still ${taskData.status}`);
        results.push({ 
          enrichment_id: enrichment.id, 
          company_name: enrichment.company_name, 
          status: taskData.status, 
          contacts_count: 0 
        });
        continue;
      }

      // Task completed - extract and save contacts
      console.log(`[Cron Check Manus] ${enrichment.company_name} COMPLETED, extracting contacts...`);

      const contactsResult = await extractAndSaveContacts(
        supabase, 
        enrichment, 
        taskData, 
        rawData
      );

      results.push({ 
        enrichment_id: enrichment.id, 
        company_name: enrichment.company_name, 
        status: "completed", 
        contacts_count: contactsResult.contactsCount,
        error: contactsResult.error
      });

    } catch (e) {
      console.error(`[Cron Check Manus] Error processing ${enrichment.company_name}:`, e);
      results.push({ 
        enrichment_id: enrichment.id, 
        company_name: enrichment.company_name, 
        status: "error", 
        contacts_count: 0,
        error: e instanceof Error ? e.message : "Unknown error"
      });
    }
  }

  const completed = results.filter(r => r.status === "completed").length;
  const totalContacts = results.reduce((sum, r) => sum + r.contacts_count, 0);

  console.log(`[Cron Check Manus] Finished: ${completed}/${processingEnrichments.length} completed, ${totalContacts} contacts extracted`);

  return new Response(
    JSON.stringify({ 
      checked: processingEnrichments.length, 
      completed, 
      total_contacts: totalContacts,
      results 
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// Helper function to extract and save contacts
async function extractAndSaveContacts(
  supabase: any,
  enrichment: any,
  taskData: any,
  rawData: any
): Promise<{ contactsCount: number; error?: string }> {
  
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

  const extractDataFromObject = (obj: any) => {
    if (!obj) return { contacts: [], error: null, companyInfo: null, searchMethod: null };
    const error = typeof obj?.error === "string" ? obj.error : null;
    const company_info = obj?.company_info || null;
    const search_method = typeof obj?.search_method === "string" ? obj.search_method : null;
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

  const tryParseDataFromText = (text: string) => {
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return { contacts: [], error: null, companyInfo: null, searchMethod: null };
      const parsed = JSON.parse(match[0]);
      return extractDataFromObject(parsed);
    } catch {
      return { contacts: [], error: null, companyInfo: null, searchMethod: null };
    }
  };

  let contacts: any[] = [];
  let manusOutputFileUrl: string | null = null;
  let manusError: string | null = null;
  let companyInfo: any = null;
  let searchMethod: string | null = null;

  const output = taskData.output;

  // Parse output
  if (Array.isArray(output)) {
    for (const message of output) {
      const role = message?.role;
      const content = Array.isArray(message?.content) ? message.content : [];

      for (const block of content) {
        const fileUrl = block?.fileUrl || block?.file_url;
        if (block?.type === "output_file" && fileUrl) {
          const fileName = String(block?.fileName || block?.file_name || "");
          const mimeType = String(block?.mimeType || block?.mime_type || "");
          const isJson = mimeType.includes("json") || fileName.toLowerCase().endsWith(".json");
          if (isJson) manusOutputFileUrl = String(fileUrl);
        }

        if (!contacts.length && role === "assistant" && block?.type === "output_text" && typeof block?.text === "string") {
          const extracted = tryParseDataFromText(block.text);
          if (extracted.contacts.length) contacts = extracted.contacts;
          if (extracted.error) manusError = extracted.error;
          if (extracted.companyInfo) companyInfo = extracted.companyInfo;
          if (extracted.searchMethod) searchMethod = extracted.searchMethod;
        }
      }
    }
  } else if (typeof output === "string") {
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

  // Try JSON file if available
  if (manusOutputFileUrl) {
    console.log(`[Cron Check Manus] Downloading JSON file: ${manusOutputFileUrl.substring(0, 100)}...`);
    try {
      const fileResp = await fetch(manusOutputFileUrl);
      if (fileResp.ok) {
        const fileJson = await fileResp.json();
        const fileData = extractDataFromObject(fileJson);
        if (fileData.contacts.length) {
          contacts = fileData.contacts;
          console.log(`[Cron Check Manus] Extracted ${contacts.length} contacts from file`);
        }
        if (fileData.error) manusError = fileData.error;
        if (fileData.companyInfo) companyInfo = fileData.companyInfo;
        if (fileData.searchMethod) searchMethod = fileData.searchMethod;
      }
    } catch (e) {
      console.error("[Cron Check Manus] Failed to fetch output file:", e);
    }
  }

  // Check if contacts already exist
  const { data: existingContacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("signal_id", enrichment.signal_id)
    .limit(1);

  let insertedCount = 0;

  if ((!existingContacts || existingContacts.length === 0) && contacts.length > 0) {
    const norm = (v: any) => (typeof v === "string" ? v.trim() : null);
    const deriveNames = (fullName: string | null) => {
      if (!fullName) return { first_name: null, last_name: null };
      const parts = fullName.split(/\s+/).filter(Boolean);
      if (parts.length <= 1) return { first_name: parts[0] ?? null, last_name: null };
      return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(" ") || null };
    };
    const getPriorityScore = (jobTitle: string | null) => {
      const t = (jobTitle || "").toLowerCase();
      if (t.includes("assistant") || t.includes("office manager") || t.includes("procurement")) return 5;
      if (t.includes("admin") || t.includes("operations")) return 4;
      return 3;
    };

    const contactRows = contacts.map((c: any) => {
      const full_name = norm(c.full_name) || null;
      const fromFull = deriveNames(full_name);
      const first_name = norm(c.first_name) || fromFull.first_name;
      const last_name = norm(c.last_name) || fromFull.last_name;
      const job_title = norm(c.job_title) || null;
      const priority_score = typeof c.priority_score === "number" ? c.priority_score : getPriorityScore(job_title);

      return {
        enrichment_id: enrichment.id,
        signal_id: enrichment.signal_id,
        full_name: full_name || [first_name, last_name].filter(Boolean).join(" ") || "Contact",
        first_name,
        last_name,
        job_title,
        department: norm(c.department),
        location: norm(c.location),
        email_principal: norm(c.email_principal) || norm(c.email),
        email_alternatif: norm(c.email_alternatif),
        phone: norm(c.phone),
        linkedin_url: norm(c.linkedin_url),
        is_priority_target: priority_score >= 4,
        priority_score,
        outreach_status: "new",
        raw_data: { source: "manus", manus_task_id: rawData?.manus_task_id },
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from("contacts")
      .insert(contactRows)
      .select("id");

    if (insertError) {
      console.error("[Cron Check Manus] Insert error:", insertError);
    } else {
      insertedCount = inserted?.length || 0;
      console.log(`[Cron Check Manus] Inserted ${insertedCount} contacts`);
    }
  }

  // Update enrichment status
  const enrichmentUpdate: any = {
    status: "completed",
    raw_data: { 
      ...rawData, 
      manus_output: taskData.output,
      search_method: searchMethod,
      manus_error: manusError,
      completed_at: new Date().toISOString(),
    },
  };

  if (companyInfo) {
    if (companyInfo.website && companyInfo.website !== "N/A") enrichmentUpdate.website = companyInfo.website;
    if (companyInfo.industry && companyInfo.industry !== "N/A") enrichmentUpdate.industry = companyInfo.industry;
    if (companyInfo.employee_count && companyInfo.employee_count !== "N/A") enrichmentUpdate.employee_count = companyInfo.employee_count;
    if (companyInfo.headquarters && companyInfo.headquarters !== "N/A") enrichmentUpdate.headquarters_location = companyInfo.headquarters;
  }

  if (contacts.length === 0 && manusError) {
    enrichmentUpdate.error_message = manusError;
  }

  await supabase
    .from("company_enrichment")
    .update(enrichmentUpdate)
    .eq("id", enrichment.id);

  await supabase
    .from("signals")
    .update({ enrichment_status: "completed" })
    .eq("id", enrichment.signal_id);

  return { contactsCount: contacts.length, error: manusError || undefined };
}

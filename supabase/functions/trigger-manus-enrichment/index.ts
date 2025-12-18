import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EnrichmentRequest {
  signal_id: string;
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

    // 5. Call Lovable AI to generate mock enrichment data
    // In production, this would call the actual Manus API
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    
    if (!LOVABLE_API_KEY) {
      // Fallback: generate mock data without AI
      console.log("[Manus Enrichment] No LOVABLE_API_KEY, using mock data");
      
      const mockContacts = generateMockContacts(signal.company_name, signal.sector);
      
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

      console.log(`[Manus Enrichment] Completed with ${mockContacts.length} contacts`);

      return new Response(
        JSON.stringify({
          success: true,
          message: `Enrichment completed with ${mockContacts.length} contacts`,
          contacts_count: mockContacts.length,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Use AI to generate realistic contacts based on company info
    console.log("[Manus Enrichment] Using Lovable AI for enrichment");

    const aiPrompt = `Tu es un assistant qui génère des données de contacts professionnels réalistes pour une entreprise.

Entreprise: ${signal.company_name}
Secteur: ${signal.sector || "Non spécifié"}
Taille estimée: ${signal.estimated_size || "Non spécifié"}
Type d'événement: ${signal.signal_type}

Génère exactement 3 à 5 contacts décideurs réalistes pour cette entreprise. Pour chaque contact, fournis:
- full_name: nom complet français réaliste
- first_name: prénom
- last_name: nom de famille
- job_title: poste (CEO, DG, Directeur Commercial, DAF, etc.)
- department: département (Direction, Commercial, Finance, etc.)
- location: ville en France
- email_principal: email professionnel (format: prenom.nom@domaine.com)
- linkedin_url: URL LinkedIn fictive
- is_priority_target: true si c'est un décideur clé (CEO, DG, Directeur)
- priority_score: score de 1 à 5 (5 = très prioritaire)

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
      const mockContacts = generateMockContacts(signal.company_name, signal.sector);
      
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

// Helper function to generate mock contacts
function generateMockContacts(companyName: string, sector: string | null) {
  const domain = companyName.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "") + ".com";
  
  const mockFirstNames = ["Jean", "Marie", "Pierre", "Sophie", "François", "Claire", "Nicolas", "Isabelle"];
  const mockLastNames = ["Dupont", "Martin", "Bernard", "Petit", "Robert", "Richard", "Durand", "Leroy"];
  const mockTitles = [
    { title: "Directeur Général", dept: "Direction", priority: 5, isPriority: true },
    { title: "Directeur Commercial", dept: "Commercial", priority: 4, isPriority: true },
    { title: "Directeur Financier", dept: "Finance", priority: 4, isPriority: true },
    { title: "Responsable Achats", dept: "Achats", priority: 3, isPriority: false },
    { title: "Responsable Marketing", dept: "Marketing", priority: 3, isPriority: false },
  ];
  const cities = ["Paris", "Lyon", "Marseille", "Toulouse", "Bordeaux"];

  const numContacts = Math.floor(Math.random() * 3) + 3; // 3-5 contacts
  const contacts = [];

  for (let i = 0; i < numContacts && i < mockTitles.length; i++) {
    const firstName = mockFirstNames[Math.floor(Math.random() * mockFirstNames.length)];
    const lastName = mockLastNames[Math.floor(Math.random() * mockLastNames.length)];
    const titleInfo = mockTitles[i];
    const city = cities[Math.floor(Math.random() * cities.length)];

    contacts.push({
      full_name: `${firstName} ${lastName}`,
      first_name: firstName,
      last_name: lastName,
      job_title: titleInfo.title,
      department: titleInfo.dept,
      location: city,
      email_principal: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
      linkedin_url: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${Math.random().toString(36).substring(7)}`,
      is_priority_target: titleInfo.isPriority,
      priority_score: titleInfo.priority,
      outreach_status: "new",
    });
  }

  return contacts;
}

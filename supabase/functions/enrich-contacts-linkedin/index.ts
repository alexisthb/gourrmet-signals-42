import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { submitCompanyEmployeesRun } from "../_shared/apify-linkedin.ts";

// ─────────────────────────────────────────────────────────────────────────────
// enrich-contacts-linkedin (v2) — dispatcher ASYNCHRONE.
//
// Trouve les ACHETEURS OPÉRATIONNELS (office manager, assistante de direction, achats,
// communication, RH, événementiel) chez l'entreprise du signal — les VRAIS interlocuteurs
// cadeaux Gourmet, pas les dirigeants légaux Pappers.
//
// Ici : on SOUMET juste la run Apify (scrape LinkedIn = plusieurs minutes) et on rend la main
// tout de suite. Le cron `cron-check-linkedin-enrich` récolte, filtre par persona, vérifie les
// emails via Dropcontact et écrit les contacts. Contrat DB identique aux autres voies.
//
// Routage : enrichment-worker quand settings.enrichment_provider = 'linkedin'.
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let enrichmentId: string | null = null;
  try {
    const { signal_id } = await req.json();
    if (!signal_id) {
      return new Response(JSON.stringify({ error: "signal_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: signal, error: sigErr } = await supabase
      .from("signals").select("*").eq("id", signal_id).single();
    if (sigErr || !signal) {
      return new Response(JSON.stringify({ error: "Signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gate Pappers (même sémantique que les autres voies : seul 'false' bloque).
    if ((signal.source_name || "") === "Pappers") {
      const { data: gate } = await supabase
        .from("settings").select("value").eq("key", "pappers_enrichment_enabled").maybeSingle();
      if (gate?.value === "false") {
        return new Response(JSON.stringify({ skipped: true, reason: "pappers_enrichment_suspended" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Idempotence + anti-doublon (tâche déjà en vol récente).
    const { data: existing } = await supabase
      .from("company_enrichment").select("*").eq("signal_id", signal_id).maybeSingle();
    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, message: "already enriched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (existing && ["processing", "linkedin_processing", "dropcontact_processing"].includes(existing.status)) {
      const started = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
      if (Date.now() - started < 30 * 60_000) {
        return new Response(JSON.stringify({ success: true, already_running: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");
    if (!APIFY_API_KEY) {
      return new Response(JSON.stringify({ error: "APIFY_API_KEY manquante" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enregistrement -> processing
    if (existing) {
      enrichmentId = existing.id;
      await supabase.from("company_enrichment").update({ status: "processing", enrichment_source: "linkedin" }).eq("id", enrichmentId);
    } else {
      const { data: created, error: insErr } = await supabase
        .from("company_enrichment")
        .insert({ signal_id, company_name: signal.company_name, status: "processing", enrichment_source: "linkedin" })
        .select().single();
      if (insErr) throw new Error(`create enrichment: ${insErr.message}`);
      enrichmentId = created.id;
    }
    await supabase.from("signals").update({ enrichment_status: "processing" }).eq("id", signal_id);

    // Soumet la run Apify (asynchrone).
    const submitted = await submitCompanyEmployeesRun(APIFY_API_KEY, signal.company_name);
    if ("error" in submitted) {
      await supabase.from("company_enrichment").update({
        status: "failed",
        error_message: `LinkedIn (Apify) : ${submitted.error}`.slice(0, 300),
        raw_data: { source: "linkedin", outcome: "apify_submit_error", failed_at: new Date().toISOString() },
      }).eq("id", enrichmentId);
      await supabase.from("signals").update({ enrichment_status: "failed" }).eq("id", signal_id);
      return new Response(JSON.stringify({ error: submitted.error }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stocke le runId pour le cron. Statut 'linkedin_processing' : l'UI voit "en cours" via le job.
    await supabase.from("company_enrichment").update({
      status: "linkedin_processing",
      enrichment_source: "linkedin",
      raw_data: {
        source: "linkedin",
        apify_run_id: submitted.runId,
        apify_dataset_id: submitted.datasetId,
        company_query: signal.company_name,
        started_at: new Date().toISOString(),
      },
    }).eq("id", enrichmentId);
    await supabase.from("signals").update({ enrichment_status: "manus_processing" }).eq("id", signal_id);

    return new Response(JSON.stringify({
      success: true, provider: "linkedin", signal_id, enrichment_id: enrichmentId, apify_run_id: submitted.runId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[enrich-contacts-linkedin] Error:", msg);
    if (enrichmentId) {
      await supabase.from("company_enrichment").update({
        status: "failed", error_message: `LinkedIn: ${msg}`.slice(0, 300),
        raw_data: { source: "linkedin", outcome: "exception", failed_at: new Date().toISOString() },
      }).eq("id", enrichmentId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

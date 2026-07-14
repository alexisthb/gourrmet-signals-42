import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkApifyRun, getApifyDataset, filterOperationalPersonas, firstGivenName } from "../_shared/apify-linkedin.ts";
import { submitDropcontactBatch, pollDropcontactBatch, pickVerifiedEmail } from "../_shared/dropcontact.ts";

// ─────────────────────────────────────────────────────────────────────────────
// cron-check-linkedin-enrich — poller de la voie LinkedIn (v2). Appelé chaque minute.
//
// Étage A (status 'linkedin_processing') : la run Apify est-elle finie ?
//   -> SUCCEEDED : récupère le dataset, filtre les personas opérationnels, dédoublonne,
//      soumet Dropcontact, passe en 'dropcontact_processing'.
//   -> 0 profil opérationnel : 'failed' (entreprise trop petite / pas de cible) — visible.
//   -> FAILED/ABORTED/stale : 'failed'.
// Étage B (status 'dropcontact_processing') : les emails Dropcontact sont-ils prêts ?
//   -> oui : écrit les contacts (email vérifié quand trouvé), passe en 'completed'.
//   -> stale : écrit quand même les contacts (noms/LinkedIn sans email), 'completed'.
// ─────────────────────────────────────────────────────────────────────────────

const LINKEDIN_STALE_MIN = 30;   // run Apify perdue au-delà
const DROPCONTACT_STALE_MIN = 12; // lot Dropcontact jamais prêt au-delà -> on écrit sans email
const BATCH = 8;                  // enrichissements traités par tick

function norm(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(n\/?a|na|-|null|none|undefined)$/i.test(t)) return null;
  return t;
}
function ageMin(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : (Date.now() - t) / 60_000;
}

async function markFailed(supabase: any, enr: any, reason: string, outcome: string) {
  await supabase.from("company_enrichment").update({
    status: "failed",
    error_message: reason.slice(0, 300),
    raw_data: { ...(enr.raw_data || {}), outcome, failed_at: new Date().toISOString() },
  }).eq("id", enr.id);
  await supabase.from("signals").update({ enrichment_status: "failed" }).eq("id", enr.signal_id);
}

// Écrit les contacts (candidats opérationnels + emails Dropcontact zippés par index).
async function writeContacts(supabase: any, enr: any, candidates: any[], dcData: any[]): Promise<number> {
  const seen = new Set<string>();
  const rows = candidates.map((c, i) => {
    const res = dcData[i] || {};
    const verified = pickVerifiedEmail(res?.email);
    const full_name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
    return {
      enrichment_id: enr.id,
      signal_id: enr.signal_id,
      full_name,
      first_name: c.first_name,
      last_name: c.last_name,
      job_title: c.job_title,
      department: null,
      location: c.location || null,
      email_principal: verified?.email || null,
      email_alternatif: null,
      phone: norm(res?.phone) || norm(res?.mobile_phone),
      linkedin_url: c.linkedin_url || null,
      is_priority_target: true, // profil opérationnel = cible cadeaux prioritaire
      priority_score: 5,
      outreach_status: "new",
      raw_data: {
        source: "linkedin",
        contact_source: "linkedin+dropcontact",
        email_status: verified ? "verified" : "no_email",
        email_qualification: verified?.qualification || null,
      },
    };
  }).filter((r) => {
    if (!r.full_name) return false;
    const key = (r.linkedin_url || `${r.first_name}|${r.last_name}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (rows.length === 0) return 0;
  const { data: inserted, error } = await supabase.from("contacts").insert(rows).select("id");
  if (error) {
    console.error("[cron-linkedin] insert contacts error:", error.message);
    return 0;
  }
  return inserted?.length || 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";
  let DROPCONTACT_API_KEY = Deno.env.get("DROPCONTACT_API_KEY") || "";
  if (!DROPCONTACT_API_KEY) {
    const { data } = await supabase.from("settings").select("value").eq("key", "dropcontact_api_key").maybeSingle();
    DROPCONTACT_API_KEY = data?.value || "";
  }

  const summary = { apify_checked: 0, dropcontact_done: 0, contacts_written: 0, failed: 0 };

  try {
    // ── Étage A : runs Apify en cours ─────────────────────────────────────────
    const { data: aRows } = await supabase
      .from("company_enrichment").select("*").eq("status", "linkedin_processing")
      .order("updated_at", { ascending: true }).limit(BATCH);

    for (const enr of aRows || []) {
      const rd = enr.raw_data || {};
      summary.apify_checked++;
      if (!rd.apify_run_id || !APIFY_API_KEY) {
        await markFailed(supabase, enr, "Run Apify introuvable ou clé absente.", "apify_missing");
        summary.failed++;
        continue;
      }
      if (ageMin(rd.started_at) > LINKEDIN_STALE_MIN) {
        await markFailed(supabase, enr, "Run LinkedIn expirée (>30min).", "apify_stale");
        summary.failed++;
        continue;
      }
      const run = await checkApifyRun(APIFY_API_KEY, rd.apify_run_id);
      if (run.status === "RUNNING" || run.status === "READY" || run.status === "UNKNOWN") continue; // pas prêt, tick suivant
      if (run.status !== "SUCCEEDED") {
        await markFailed(supabase, enr, `Run LinkedIn ${run.status}.`, "apify_" + run.status.toLowerCase());
        summary.failed++;
        continue;
      }

      const datasetId = run.datasetId || rd.apify_dataset_id;
      const items = datasetId ? await getApifyDataset(APIFY_API_KEY, datasetId) : [];
      const candidates = filterOperationalPersonas(items);

      if (candidates.length === 0) {
        await markFailed(
          supabase, enr,
          `Aucun profil opérationnel trouvé sur LinkedIn (${items.length} employés scannés — entreprise trop petite ?).`,
          "no_operational_profiles",
        );
        summary.failed++;
        continue;
      }

      // Soumet Dropcontact pour vérifier les emails (prénom nettoyé).
      const dcInputs = candidates.map((c) => ({
        first_name: firstGivenName(c.first_name) || undefined,
        last_name: c.last_name || undefined,
        company: enr.company_name || undefined,
      }));
      let outcome = "dropcontact_pending";
      let dropcontact_request_id: string | null = null;
      if (DROPCONTACT_API_KEY) {
        const sub = await submitDropcontactBatch(DROPCONTACT_API_KEY, dcInputs);
        if ("request_id" in sub) dropcontact_request_id = sub.request_id;
        else { outcome = "dropcontact_submit_error"; console.warn("[cron-linkedin]", sub.error); }
      } else {
        outcome = "dropcontact_not_configured";
      }

      if (!dropcontact_request_id) {
        // Pas de vérif email possible : on écrit quand même les profils (noms + LinkedIn).
        const n = await writeContacts(supabase, enr, candidates, []);
        await supabase.from("company_enrichment").update({
          status: "completed", enrichment_source: "linkedin",
          raw_data: { ...rd, outcome, employees_scanned: items.length, contacts_total: n, contacts_with_verified_email: 0, completed_at: new Date().toISOString() },
        }).eq("id", enr.id);
        await supabase.from("signals").update({ enrichment_status: "completed" }).eq("id", enr.signal_id);
        summary.contacts_written += n;
        continue;
      }

      await supabase.from("company_enrichment").update({
        status: "dropcontact_processing",
        raw_data: { ...rd, outcome: "dropcontact_pending", dropcontact_request_id, employees_scanned: items.length, candidates, dropcontact_submitted_at: new Date().toISOString() },
      }).eq("id", enr.id);
    }

    // ── Étage B : lots Dropcontact en cours ───────────────────────────────────
    const { data: bRows } = await supabase
      .from("company_enrichment").select("*").eq("status", "dropcontact_processing")
      .order("updated_at", { ascending: true }).limit(BATCH);

    for (const enr of bRows || []) {
      const rd = enr.raw_data || {};
      const candidates: any[] = Array.isArray(rd.candidates) ? rd.candidates : [];
      const stale = ageMin(rd.dropcontact_submitted_at) > DROPCONTACT_STALE_MIN;

      let dcData: any[] = [];
      if (rd.dropcontact_request_id && DROPCONTACT_API_KEY) {
        const polled = await pollDropcontactBatch(DROPCONTACT_API_KEY, rd.dropcontact_request_id, { maxAttempts: 1, delayMs: 500 });
        if ("data" in polled) dcData = polled.data;
        else if (!stale) continue; // pas encore prêt, on repolle au prochain tick
        // stale + pas prêt -> on écrit sans email (dcData vide)
      }

      const n = await writeContacts(supabase, enr, candidates, dcData);
      const withEmail = dcData.length ? candidates.filter((_c, i) => pickVerifiedEmail(dcData[i]?.email)).length : 0;
      await supabase.from("company_enrichment").update({
        status: "completed", enrichment_source: "linkedin",
        raw_data: { ...rd, outcome: dcData.length ? "completed" : "completed_no_email", contacts_total: n, contacts_with_verified_email: withEmail, completed_at: new Date().toISOString() },
      }).eq("id", enr.id);
      await supabase.from("signals").update({ enrichment_status: "completed" }).eq("id", enr.signal_id);
      summary.dropcontact_done++;
      summary.contacts_written += n;
    }

    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[cron-check-linkedin-enrich] Error:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown", ...summary }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

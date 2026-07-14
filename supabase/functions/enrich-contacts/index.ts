import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  submitDropcontactBatch,
  pollDropcontactBatch,
  pickVerifiedEmail,
  type DropcontactInput,
} from "../_shared/dropcontact.ts";

// ─────────────────────────────────────────────────────────────────────────────
// enrich-contacts — enrichissement contacts SANS Manus (cascade "waterfall").
//
//   SIREN → fiche Pappers (représentants RÉELS) → Dropcontact (email pro vérifié) → contacts
//
// v1 : couvre le canal Pappers (le gros du volume/coût). Les personnes viennent du registre
// légal (jamais inventées) ; Dropcontact n'ajoute qu'un email vérifié (jamais un nom).
// Synchrone : la fonction écrit les contacts et termine l'enrichissement dans le même appel
// (polling Dropcontact borné pour rester sous le timeout worker de 60 s). Aucun cron requis.
//
// Routage : appelée par enrichment-worker quand settings.enrichment_provider='waterfall'.
// Contrat DB IDENTIQUE à la voie Manus (mêmes colonnes contacts/company_enrichment) pour que
// l'UI, les hooks et le reste ne voient aucune différence.
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichmentRequest {
  signal_id: string;
}

interface Candidate {
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  source: string; // provenance du NOM (ex: "pappers")
}

// Normalise "N/A"/"-"/vide -> null (mêmes littéraux que la voie Manus).
function norm(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(n\/?a|na|-|null|none|undefined)$/i.test(t)) return null;
  return t;
}

function deriveNames(fullName: string | null): { first_name: string | null; last_name: string | null } {
  if (!fullName) return { first_name: null, last_name: null };
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] ?? null, last_name: null };
  return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(" ") || null };
}

// Pappers renvoie souvent TOUS les prénoms d'état civil ("Marc, Marcel", "Matthieu, Jean, Marie").
// Testé : ce format casse TOTALEMENT l'enrichissement Dropcontact (0 email, 0 résolution).
// On ne garde donc que le 1er prénom (avant la 1re virgule), en préservant les composés à
// trait d'union ("Jean-Pierre"). Améliore aussi l'affichage du contact.
function cleanFirstName(s: string | null): string | null {
  if (!s) return s;
  const first = s.split(",")[0].trim();
  return first || s;
}

// Scoring persona IDENTIQUE à cron-check-manus (office manager/assistante=5, direction=4…),
// + bonus de fraîcheur du signal. is_priority_target = score >= 4.
function personaBaseScore(jobTitle: string | null): number {
  const t = (jobTitle || "").toLowerCase();
  if (t.includes("assistant") || t.includes("office manager") || t.includes("procurement") || t.includes("achat")) return 5;
  if (t.includes("admin") || t.includes("operations") || t.includes("directeur") || t.includes("daf") || t.includes("drh") || t.includes("gerant") || t.includes("gérant") || t.includes("president") || t.includes("président")) return 4;
  return 3;
}
function freshnessBonus(detectedAt: string | null): number {
  if (!detectedAt) return 0;
  const days = (Date.now() - new Date(detectedAt).getTime()) / 86_400_000;
  if (days <= 7) return 2;
  if (days <= 30) return 1;
  return 0;
}

// Extrait les représentants PERSONNES PHYSIQUES d'une fiche Pappers v2.
function extractPappersReps(fiche: any): { candidates: Candidate[]; website: string | null; industry: string | null } {
  const raw = [
    ...(Array.isArray(fiche?.representants) ? fiche.representants : []),
    ...(Array.isArray(fiche?.dirigeants) ? fiche.dirigeants : []),
  ];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of raw) {
    // On écarte les représentants "personne morale" (une société dirige la société) : pas de nom exploitable.
    if (r?.personne_morale === true || r?.est_personne_morale === true) continue;
    let first = norm(r?.prenom);
    let last = norm(r?.nom) || norm(r?.nom_famille);
    if (!first && !last) {
      const full = norm(r?.nom_complet) || norm(r?.nom_complet_sans_civilite);
      const d = deriveNames(full);
      first = d.first_name;
      last = d.last_name;
    }
    first = cleanFirstName(first);
    if (!first && !last) continue;
    const key = `${(first || "").toLowerCase()}|${(last || "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      first_name: first,
      last_name: last,
      job_title: norm(r?.qualite) || norm(r?.fonction) || null,
      source: "pappers",
    });
  }
  const website = norm(fiche?.site_web) || norm(fiche?.siege?.site_web) || null;
  const industry = norm(fiche?.libelle_code_naf) || norm(fiche?.domaine_activite) || null;
  return { candidates, website, industry };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let enrichmentId: string | null = null;
  try {
    const { signal_id }: EnrichmentRequest = await req.json();
    if (!signal_id) {
      return new Response(JSON.stringify({ error: "signal_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Signal
    const { data: signal, error: signalError } = await supabase
      .from("signals").select("*").eq("id", signal_id).single();
    if (signalError || !signal) {
      return new Response(JSON.stringify({ error: "Signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Gate Pappers (même sémantique que la voie Manus : seul 'false' bloque).
    if ((signal.source_name || "") === "Pappers") {
      const { data: gate } = await supabase
        .from("settings").select("value").eq("key", "pappers_enrichment_enabled").maybeSingle();
      if (gate?.value === "false") {
        return new Response(JSON.stringify({ skipped: true, reason: "pappers_enrichment_suspended", signal_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 3. Déjà enrichi / en vol (idempotence, anti-doublon).
    const { data: existing } = await supabase
      .from("company_enrichment").select("*").eq("signal_id", signal_id).maybeSingle();
    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, message: "Signal already enriched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (existing && existing.status === "processing") {
      const startedMs = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
      if (Date.now() - startedMs < 5 * 60_000) {
        return new Response(JSON.stringify({ success: true, already_running: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4. Clé Dropcontact (env puis settings, comme les autres providers).
    let DROPCONTACT_API_KEY = Deno.env.get("DROPCONTACT_API_KEY") || null;
    if (!DROPCONTACT_API_KEY) {
      const { data: s } = await supabase.from("settings").select("value").eq("key", "dropcontact_api_key").maybeSingle();
      DROPCONTACT_API_KEY = s?.value || null;
    }

    // 5. Enregistrement d'enrichissement -> 'processing'
    if (existing) {
      enrichmentId = existing.id;
      await supabase.from("company_enrichment").update({ status: "processing", enrichment_source: "waterfall" }).eq("id", enrichmentId);
    } else {
      const { data: created, error: insErr } = await supabase
        .from("company_enrichment")
        .insert({ signal_id, company_name: signal.company_name, status: "processing", enrichment_source: "waterfall" })
        .select().single();
      if (insErr) throw new Error(`create enrichment: ${insErr.message}`);
      enrichmentId = created.id;
    }
    await supabase.from("signals").update({ enrichment_status: "processing" }).eq("id", signal_id);

    // 6. Récupère le SIREN (posé sur pappers_signals lors du transfert) puis la fiche Pappers.
    const { data: pappersRow } = await supabase
      .from("pappers_signals").select("siren, company_data").eq("signal_id", signal_id).limit(1).maybeSingle();
    const siren = norm(pappersRow?.siren) || norm(signal?.siren);

    let candidates: Candidate[] = [];
    let website: string | null = null;
    let industry: string | null = (typeof signal.sector === "string" ? signal.sector : null);

    const PAPPERS_API_KEY = Deno.env.get("PAPPERS_API_KEY") || null;
    if (siren && PAPPERS_API_KEY) {
      try {
        const url = `https://api.pappers.fr/v2/entreprise?api_token=${PAPPERS_API_KEY}&siren=${encodeURIComponent(siren)}`;
        const resp = await fetch(url);
        if (resp.ok) {
          const fiche = await resp.json();
          const ex = extractPappersReps(fiche);
          candidates = ex.candidates;
          website = ex.website;
          industry = ex.industry || industry;
        } else {
          console.warn(`[enrich-contacts] Pappers fiche ${resp.status} pour SIREN ${siren}`);
        }
      } catch (e) {
        console.error("[enrich-contacts] Pappers fiche error:", e instanceof Error ? e.message : e);
      }
    }

    // Pas de représentant exploitable (ex. signal Presse sans SIREN, ou fiche vide) : on ne
    // fabrique rien. La découverte de contacts opérationnels arrive en v2 (Perplexity+Apify).
    if (candidates.length === 0) {
      await supabase.from("company_enrichment").update({
        status: "failed",
        error_message: siren
          ? "Aucun représentant personne physique dans la fiche Pappers."
          : "Signal sans SIREN — enrichissement waterfall v1 limité au canal Pappers.",
        raw_data: { source: "waterfall", outcome: "no_candidates", siren: siren || null, failed_at: new Date().toISOString() },
      }).eq("id", enrichmentId);
      await supabase.from("signals").update({ enrichment_status: "failed" }).eq("id", signal_id);
      return new Response(JSON.stringify({ success: false, reason: "no_candidates", signal_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Dropcontact : email pro vérifié pour chaque représentant réel (best-effort).
    // L'ordre des résultats Dropcontact suit l'ordre d'entrée -> on zippe par index.
    let verifiedByIndex: Array<{ email: string; qualification: string } | null> = candidates.map(() => null);
    let phonesByIndex: Array<string | null> = candidates.map(() => null);
    let dropcontactNote = "not_configured";
    // Observabilité : réponse brute Dropcontact (tronquée) — permet d'auditer d'où vient
    // (ou ne vient pas) un email, sans redéployer à chaque diagnostic.
    let dcDebug: string | null = null;

    if (DROPCONTACT_API_KEY) {
      const inputs: DropcontactInput[] = candidates.map((c) => ({
        first_name: c.first_name || undefined,
        last_name: c.last_name || undefined,
        company: signal.company_name || undefined,
        website: website || undefined,
        num_siren: siren || undefined,
      }));
      const submitted = await submitDropcontactBatch(DROPCONTACT_API_KEY, inputs);
      if ("request_id" in submitted) {
        const polled = await pollDropcontactBatch(DROPCONTACT_API_KEY, submitted.request_id, { maxAttempts: 7, delayMs: 6000 });
        if ("data" in polled) {
          dropcontactNote = "ok";
          dcDebug = JSON.stringify(polled.data).slice(0, 4000);
          polled.data.forEach((res, i) => {
            if (i < candidates.length) {
              verifiedByIndex[i] = pickVerifiedEmail(res.email);
              phonesByIndex[i] = norm(res.phone) || norm(res.mobile_phone);
            }
          });
        } else {
          // Lot pas prêt à temps : on garde les noms réels (emails à défaut). Pas un échec.
          dropcontactNote = polled.pending ? "pending_timeout" : "poll_error";
        }
      } else {
        dropcontactNote = `submit_error: ${submitted.error}`;
        console.warn(`[enrich-contacts] ${dropcontactNote}`);
      }
    }

    // 8. Construit les lignes contacts (contrat DB identique à la voie Manus).
    const detectedAt: string | null = signal.detected_at || null;
    const contactRows = candidates.map((c, i) => {
      const full_name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
      const priority_score = Math.min(5, personaBaseScore(c.job_title) + freshnessBonus(detectedAt));
      const verified = verifiedByIndex[i];
      return {
        enrichment_id: enrichmentId,
        signal_id,
        full_name,
        first_name: c.first_name,
        last_name: c.last_name,
        job_title: c.job_title,
        department: null,
        location: null,
        email_principal: verified?.email || null,
        email_alternatif: null,
        phone: phonesByIndex[i],
        linkedin_url: null,
        is_priority_target: priority_score >= 4,
        priority_score,
        outreach_status: "new",
        raw_data: {
          source: "waterfall",
          contact_source: c.source,
          email_status: verified ? "verified" : "registry_no_email",
          email_qualification: verified?.qualification || null,
        },
      };
    }).filter((row) => row.full_name);

    let insertedCount = 0;
    if (contactRows.length > 0) {
      const { data: inserted, error: insErr } = await supabase.from("contacts").insert(contactRows).select("id");
      if (insErr) throw new Error(`insert contacts: ${insErr.message}`);
      insertedCount = inserted?.length || 0;
    }

    // 9. Finalise l'enrichissement.
    const withEmail = contactRows.filter((r) => r.email_principal).length;
    await supabase.from("company_enrichment").update({
      status: "completed",
      enrichment_source: "waterfall",
      website: website,
      industry: industry,
      error_message: null,
      raw_data: {
        source: "waterfall",
        outcome: "completed",
        siren: siren || null,
        dropcontact: dropcontactNote,
        dropcontact_debug: dcDebug,
        contacts_total: insertedCount,
        contacts_with_verified_email: withEmail,
        completed_at: new Date().toISOString(),
      },
    }).eq("id", enrichmentId);
    await supabase.from("signals").update({ enrichment_status: "completed" }).eq("id", signal_id);

    return new Response(JSON.stringify({
      success: true,
      provider: "waterfall",
      signal_id,
      enrichment_id: enrichmentId,
      contacts_inserted: insertedCount,
      contacts_with_verified_email: withEmail,
      dropcontact: dropcontactNote,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[enrich-contacts] Error:", msg);
    if (enrichmentId) {
      await supabase.from("company_enrichment").update({
        status: "failed",
        error_message: `Waterfall: ${msg}`.slice(0, 300),
        raw_data: { source: "waterfall", outcome: "exception", failed_at: new Date().toISOString() },
      }).eq("id", enrichmentId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

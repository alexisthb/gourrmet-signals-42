// Maintenance Presse — point d'entrée admin unique pour :
//   - report            : compteurs (aucune mutation)
//   - relaunch_contacts : reset + ré-enqueue des signaux Presse bloqués (contacts)
//   - relaunch_logos    : reset logo_manus_task_id + relance fetch-company-logo (batched)
//   - resolve_problemes : relance contacts+logos des status='probleme' + repasse 'new'
//   - wipe_mocks        : purge contacts/enrichissements mock (mock/lovable_ai/seed)
//   - all               : report -> wipe_mocks -> relaunch_contacts -> relaunch_logos
//
// Sécurité : exige un JWT d'un user avec role 'admin' (table user_roles), même
// contrat que wipe-seed-data. Les opérations DB lourdes sont déléguées aux RPC
// SECURITY DEFINER presse_* (cf. migration 20260619140000_presse_maintenance.sql).
//
// dryRun (default TRUE) : tout est simulé et seuls les compteurs sont renvoyés.
// Pour exécuter réellement : { action, dryRun: false }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRESSE_FILTER = (q: any) =>
  q
    .not("source_name", "in", '("Pappers","LinkedIn")')
    .not("signal_type", "in", '("anniversary","capital_increase","transfer","creation","radiation","linkedin_engagement")');

type Action = "report" | "relaunch_contacts" | "relaunch_logos" | "resolve_problemes" | "wipe_mocks" | "all";

async function relaunchLogos(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  opts: { dryRun: boolean; limit: number; signalIds?: string[] },
) {
  // Cibles : logos bloqués (task_id set, url null) OU manquants (les deux null).
  // Si signalIds fourni (cas resolve_problemes), on se restreint à ceux-là.
  let query = supabase
    .from("signals")
    .select("id, company_name, source_url, logo_manus_task_id, company_logo_url")
    .is("company_logo_url", null);
  query = PRESSE_FILTER(query);
  if (opts.signalIds && opts.signalIds.length > 0) {
    query = query.in("id", opts.signalIds);
  }
  query = query.limit(opts.limit + 1); // +1 pour détecter s'il en reste

  const { data: rows, error } = await query;
  if (error) throw new Error(`select logos failed: ${error.message}`);

  const all = rows || [];
  const hasMore = all.length > opts.limit;
  const batch = all.slice(0, opts.limit);

  if (opts.dryRun) {
    return { dry_run: true, would_process: batch.length, remaining_after: hasMore ? "yes(>limit)" : 0 };
  }

  // Reset des task_id zombies puis relance fetch-company-logo, concurrence douce.
  const stuckIds = batch.filter((r: any) => r.logo_manus_task_id).map((r: any) => r.id);
  if (stuckIds.length > 0) {
    await supabase.from("signals").update({ logo_manus_task_id: null }).in("id", stuckIds);
  }

  let launched = 0;
  let failed = 0;
  const CONCURRENCY = 3;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map((r: any) =>
        fetch(`${supabaseUrl}/functions/v1/fetch-company-logo`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            signalId: r.id,
            companyName: r.company_name,
            sourceUrl: r.source_url ?? undefined,
            // logo bloqué -> on va direct à Manus (nouvelle clé) ; logo manquant -> Clearbit d'abord puis Manus
            forceRetry: true,
            forceAI: Boolean(r.logo_manus_task_id),
          }),
        }),
      ),
    );
    for (const res of results) {
      if (res.status === "fulfilled" && (res.value.ok || res.value.status === 202)) launched++;
      else failed++;
    }
  }

  return { dry_run: false, launched, failed, remaining_after: hasMore ? "yes(>limit, relancer)" : 0 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // --- Auth admin (même contrat que wipe-seed-data) ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization header missing" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: roleRow } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const action: Action = body.action || "report";
    const dryRun: boolean = body.dryRun !== false; // default TRUE
    const limit: number = Math.min(Math.max(parseInt(body.limit ?? "20", 10) || 20, 1), 50);

    const out: Record<string, unknown> = { action, dryRun, requested_by: user.email };

    if (action === "report" || action === "all") {
      const { data, error } = await admin.rpc("presse_maintenance_report");
      if (error) throw new Error(`report rpc: ${error.message}`);
      out.report = data;
    }

    if (action === "wipe_mocks" || action === "all") {
      const { data, error } = await admin.rpc("presse_wipe_mocks", { p_dry_run: dryRun });
      if (error) throw new Error(`wipe_mocks rpc: ${error.message}`);
      out.wipe_mocks = data;
    }

    if (action === "relaunch_contacts" || action === "all") {
      const { data, error } = await admin.rpc("presse_relaunch_contacts", { p_dry_run: dryRun });
      if (error) throw new Error(`relaunch_contacts rpc: ${error.message}`);
      out.relaunch_contacts = data;
    }

    if (action === "resolve_problemes") {
      const { data, error } = await admin.rpc("presse_resolve_problemes", { p_dry_run: dryRun });
      if (error) throw new Error(`resolve_problemes rpc: ${error.message}`);
      out.resolve_problemes = data;
      // relancer aussi les logos de ces signaux
      const ids: string[] = Array.isArray((data as any)?.signal_ids) ? (data as any).signal_ids : [];
      out.resolve_logos = await relaunchLogos(admin, SUPABASE_URL, SERVICE_KEY, { dryRun, limit, signalIds: ids });
    }

    if (action === "relaunch_logos" || action === "all") {
      out.relaunch_logos = await relaunchLogos(admin, SUPABASE_URL, SERVICE_KEY, { dryRun, limit });
    }

    return new Response(JSON.stringify(out, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[presse-maintenance] Error:", error instanceof Error ? error.message : error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

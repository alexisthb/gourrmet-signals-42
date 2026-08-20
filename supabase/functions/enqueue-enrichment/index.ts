// GR-010 — Edge Function pour pousser un job d'enrichissement dans la queue.
// Appelee par le front au lieu de trigger-manus-enrichment directement.
// Le worker (enrichment-worker) dépile uniquement les enrichissements contacts.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalAccess } from "../_shared/internal-auth.ts";

interface EnqueueRequest {
  signal_id: string;
  job_type?: 'contacts';
  priority?: number;
  allow_terminal_retry?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      signal_id,
      job_type = 'contacts',
      priority = 5,
      allow_terminal_retry = false,
    }: EnqueueRequest = await req.json();

    if (!signal_id) {
      return new Response(
        JSON.stringify({ error: "signal_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (job_type !== 'contacts') {
      return new Response(
        JSON.stringify({ error: "job_type must be contacts" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
      return new Response(
        JSON.stringify({ error: "priority must be an integer between 1 and 10" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (typeof allow_terminal_retry !== 'boolean') {
      return new Response(
        JSON.stringify({ error: "allow_terminal_retry must be a boolean" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GATE Pappers (amont) : ne pas enfiler de job 'contacts' pour un signal Pappers
    // si l'enrichissement Pappers est suspendu (évite de polluer la queue).
    const { data: sig } = await supabase
      .from('signals')
      .select('source_name')
      .eq('id', signal_id)
      .maybeSingle();
    if ((sig?.source_name || '') === 'Pappers') {
      const { data: pappersGate } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'pappers_enrichment_enabled')
        .maybeSingle();
      if (pappersGate?.value === 'false') {
        return new Response(
          JSON.stringify({ success: true, skipped: true, reason: 'pappers_enrichment_suspended', signal_id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Le check actif, le cooldown et l'insert sont sérialisés en base. L'index
    // partiel interdit aussi les doublons provenant d'autres producteurs.
    const { data: enqueueResult, error } = await supabase.rpc(
      'enqueue_enrichment_job_authorized',
      {
        p_signal_id: signal_id,
        p_job_type: job_type,
        p_priority: priority,
        p_cooldown_seconds: 24 * 60 * 60,
        p_allow_terminal_retry: allow_terminal_retry,
      },
    );

    if (error) {
      console.error("[enqueue-enrichment] Atomic enqueue failed:", error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: error.code === '22023' ? 400 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = enqueueResult && typeof enqueueResult === 'object'
      ? enqueueResult as Record<string, unknown>
      : {};
    if (result.state === 'cooldown') {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'cooldown',
          job_id: result.job_id ?? null,
          message: 'Enrichissement échoué récemment — réessai possible dans 24 h.',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (result.state === 'already_completed') {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'already_completed',
          job_id: result.job_id ?? null,
          message: 'Cet enrichissement est déjà terminé.',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (result.state === 'retry_requires_explicit_authorization') {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'retry_requires_explicit_authorization',
          job_id: result.job_id ?? null,
          message: 'Une nouvelle tentative doit être lancée manuellement.',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (result.state === 'retry_blocked_uncertain') {
      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          reason: 'retry_blocked_uncertain',
          blocker: result.blocker ?? null,
          job_id: result.job_id ?? null,
          message: 'Réessai bloqué : une opération fournisseur précédente doit être réconciliée.',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (result.state !== 'enqueued' && result.state !== 'active') {
      console.error("[enqueue-enrichment] Unexpected enqueue state:", result.state);
      return new Response(
        JSON.stringify({ error: "Unexpected enrichment enqueue state" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id: result.job_id ?? null,
        already_queued: result.state === 'active',
        status: result.status ?? 'pending',
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[enqueue-enrichment] Error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

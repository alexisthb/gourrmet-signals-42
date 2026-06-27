// GR-010 — Edge Function pour pousser un job d'enrichissement dans la queue.
// Appelee par le front au lieu de trigger-manus-enrichment directement.
// Le worker (enrichment-worker) depilera et appellera trigger-manus-enrichment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface EnqueueRequest {
  signal_id: string;
  job_type?: 'contacts' | 'logo' | 'company_info';
  priority?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { signal_id, job_type = 'contacts', priority = 5 }: EnqueueRequest = await req.json();

    if (!signal_id) {
      return new Response(
        JSON.stringify({ error: "signal_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GATE Pappers (amont) : ne pas enfiler de job 'contacts' pour un signal Pappers
    // si l'enrichissement Pappers est suspendu (évite de polluer la queue). Même flag/
    // convention que le gate backend. Ne concerne que job_type='contacts' (logos non impactés).
    if (job_type === 'contacts') {
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
    }

    // Dedup: si un job pending/running existe deja pour ce signal+type, on retourne l'existant.
    const { data: existing } = await supabase
      .from('enrichment_jobs')
      .select('id, status')
      .eq('signal_id', signal_id)
      .eq('job_type', job_type)
      .in('status', ['pending', 'running'])
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ success: true, job_id: existing.id, already_queued: true, status: existing.status }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: job, error } = await supabase
      .from('enrichment_jobs')
      .insert({
        signal_id,
        job_type,
        priority,
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error("[enqueue-enrichment] Insert failed:", error.message);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, job_id: job.id, already_queued: false }),
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

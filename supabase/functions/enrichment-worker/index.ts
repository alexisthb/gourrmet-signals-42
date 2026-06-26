// GR-010 — Worker qui depile la queue enrichment_jobs.
// Doit etre invoque toutes les minutes via cron Supabase (cf migration).
// Limite de concurrence via env var MAX_ENRICHMENT_CONCURRENCY (defaut 3).
//
// Logique :
//   1. Lire stats.running et comparer a max_concurrency
//   2. Tant qu'il reste du slot disponible, dequeue + appel fonction cible
//   3. En cas d'echec, planifier next_retry_at avec backoff exponentiel

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FETCH_TIMEOUT_MS = 60_000;
// Au-delà de cette durée, un job 'running' est considéré comme zombie (worker
// crashé, edge function killée avant d'updater status='failed', etc.). On le
// récupère au tick suivant. Doit être > FETCH_TIMEOUT_MS et que la durée
// raisonnable d'un trigger-manus-enrichment synchrone.
const JOB_STALE_MS = 10 * 60_000;

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function backoffDelayMs(attempt: number): number {
  // Exponential 2^n minutes, max 30 min : 2min, 4min, 8min, 16min, 30min...
  return Math.min(30, Math.pow(2, attempt)) * 60_000;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const maxConcurrency = parseInt(Deno.env.get("MAX_ENRICHMENT_CONCURRENCY") || "3", 10);

    // Recovery des jobs zombies : un job 'running' depuis plus de JOB_STALE_MS
    // est considéré perdu (worker crashé avant update). On le repasse en
    // 'pending' avec attempts++ + next_retry_at immédiat pour qu'il soit
    // redépilé en priorité. Évite que la concurrence reste saturée à cause de
    // jobs zombies (issue race condition + saturation du queue stats).
    const staleCutoff = new Date(Date.now() - JOB_STALE_MS).toISOString();
    const { data: stale } = await supabase
      .from('enrichment_jobs')
      .select('id, attempts, max_attempts')
      .eq('status', 'running')
      .lt('started_at', staleCutoff);
    if (stale && stale.length > 0) {
      console.warn(`[enrichment-worker] Recovering ${stale.length} stale running jobs`);
      for (const z of stale as { id: string; attempts: number; max_attempts: number }[]) {
        const willRetry = z.attempts < z.max_attempts;
        await supabase
          .from('enrichment_jobs')
          .update({
            status: willRetry ? 'pending' : 'failed',
            attempts: z.attempts + 1,
            error_message: 'Job timed out (worker crashed or function killed)',
            next_retry_at: willRetry ? new Date().toISOString() : null,
            finished_at: willRetry ? null : new Date().toISOString(),
          })
          .eq('id', z.id);
      }
    }

    // Plus de pré-calcul de slots à partir des stats (race condition : 2 workers
    // peuvent lire stats.running=0 simultanément et chacun dépiler N jobs ->
    // dépassement de MAX_ENRICHMENT_CONCURRENCY). On boucle simplement jusqu'à
    // maxConcurrency dépilements OU épuisement de la queue ('FOR UPDATE SKIP
    // LOCKED' dans dequeue_enrichment_job() rend l'opération sûre entre workers).

    const processed: Array<{ job_id: string; signal_id: string; result: 'started' | 'failed'; error?: string }> = [];

    for (let i = 0; i < maxConcurrency; i++) {
      const { data: jobs, error: dqError } = await supabase
        .rpc('dequeue_enrichment_job', { p_worker_id: `worker-${i}` });

      if (dqError) {
        console.error('[enrichment-worker] dequeue rpc failed:', dqError.message);
        break;
      }

      // PostgREST renvoie un array (RETURNS enrichment_jobs) — on prend le premier ou null.
      const job = Array.isArray(jobs) ? jobs[0] : jobs;
      // PostgREST hydrate un NULL composite en { id: null, ... } — on doit verifier job.id.
      if (!job || !job.id) break; // plus rien a depiler

      try {
        // Pour le moment seul job_type='contacts' est implemente (delegue a trigger-manus-enrichment).
        if (job.job_type !== 'contacts') {
          throw new Error(`Job type "${job.job_type}" not implemented yet`);
        }

        const fnUrl = `${SUPABASE_URL}/functions/v1/trigger-manus-enrichment`;
        const fnResponse = await fetchWithTimeout(fnUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ signal_id: job.signal_id }),
        }, FETCH_TIMEOUT_MS);

        const fnResult = await fnResponse.json().catch(() => ({}));

        if (fnResponse.ok) {
          await supabase
            .from('enrichment_jobs')
            .update({
              status: 'completed',
              finished_at: new Date().toISOString(),
              result: fnResult,
              external_task_id: fnResult.manus_task_id ?? null,
            })
            .eq('id', job.id);

          processed.push({ job_id: job.id, signal_id: job.signal_id, result: 'started' });
        } else {
          throw new Error(fnResult.error || `HTTP ${fnResponse.status}`);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[enrichment-worker] Job ${job.id} failed:`, errMsg);

        const shouldRetry = job.attempts < job.max_attempts;
        const updates: Record<string, unknown> = {
          error_message: errMsg,
          finished_at: new Date().toISOString(),
        };

        if (shouldRetry) {
          updates.status = 'pending';
          updates.next_retry_at = new Date(Date.now() + backoffDelayMs(job.attempts)).toISOString();
        } else {
          updates.status = 'failed';
        }

        await supabase.from('enrichment_jobs').update(updates).eq('id', job.id);

        processed.push({ job_id: job.id, signal_id: job.signal_id, result: 'failed', error: errMsg });
      }
    }

    return new Response(
      JSON.stringify({
        processed_count: processed.length,
        processed,
        recovered_stale: stale?.length ?? 0,
        max_concurrency: maxConcurrency,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[enrichment-worker] Error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

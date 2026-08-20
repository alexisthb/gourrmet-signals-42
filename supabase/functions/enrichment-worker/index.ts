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
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyEnrichmentInvocation,
  parseEnrichmentProviderRoute,
} from "../_shared/enrichment-provider-budget.ts";

const FETCH_TIMEOUT_MS = 60_000;
const CLAIM_LEASE_SECONDS = 120;
const ASYNC_LEASE_MS = 45 * 60_000;

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
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

async function updateLeasedJob(
  // Edge Functions use lease columns introduced by a migration newer than the
  // generated SDK available at runtime.
  // deno-lint-ignore no-explicit-any
  supabase: any,
  job: { id: string; lease_token?: string | null },
  updates: Record<string, unknown>,
): Promise<boolean> {
  if (!job.lease_token) throw new Error(`Job ${job.id} has no lease token`);
  const { data, error } = await supabase
    .from("enrichment_jobs")
    .update(updates)
    .eq("id", job.id)
    .eq("status", "running")
    .eq("lease_token", job.lease_token)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`persist leased job ${job.id}: ${error.message}`);
  return Boolean(data?.id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const configuredMaxConcurrency = Number.parseInt(
      Deno.env.get("MAX_ENRICHMENT_CONCURRENCY") || "8",
      10,
    );
    const maxConcurrency = Number.isInteger(configuredMaxConcurrency) &&
        configuredMaxConcurrency >= 1 && configuredMaxConcurrency <= 50
      ? configuredMaxConcurrency
      : 8;
    if (maxConcurrency !== configuredMaxConcurrency) {
      console.warn(
        "[enrichment-worker] MAX_ENRICHMENT_CONCURRENCY invalide; fallback à 8",
      );
    }

    // Provider d'enrichissement contacts. Manus est RETIRÉ : le défaut est désormais 'linkedin'
    // (découverte d'acheteurs opérationnels LinkedIn + vérification email Dropcontact), pour
    // TOUTES les sources — Pappers ET Presse. 'waterfall' (dirigeants légaux Pappers + Dropcontact)
    // reste disponible en repli via settings.enrichment_provider mais n'est plus le défaut.
    let configuredEnrichmentProvider = "linkedin";
    {
      const { data: provSetting } = await supabase
        .from("settings").select("value").eq("key", "enrichment_provider")
        .maybeSingle();
      if (
        provSetting?.value === "waterfall" || provSetting?.value === "linkedin"
      ) configuredEnrichmentProvider = provSetting.value;
    }

    // Le RPC récupère les leases expirés, compte les running frais et claim un
    // job sous le même verrou transactionnel global.

    const processed: Array<
      {
        job_id: string;
        signal_id: string;
        result: "started" | "failed";
        error?: string;
      }
    > = [];

    for (let i = 0; i < maxConcurrency; i++) {
      const { data: jobs, error: dqError } = await supabase
        .rpc("dequeue_enrichment_job", {
          p_worker_id: `worker-${crypto.randomUUID()}-${i}`,
          p_max_concurrency: maxConcurrency,
          p_lease_seconds: CLAIM_LEASE_SECONDS,
        });

      if (dqError) {
        console.error(
          "[enrichment-worker] dequeue rpc failed:",
          dqError.message,
        );
        throw new Error(`Enrichment queue unavailable: ${dqError.message}`);
      }

      // PostgREST renvoie un array (RETURNS enrichment_jobs) — on prend le premier ou null.
      const job = Array.isArray(jobs) ? jobs[0] : jobs;
      // PostgREST hydrate un NULL composite en { id: null, ... } — on doit verifier job.id.
      if (!job || !job.id) break; // plus rien a depiler

      let enrichmentProvider: "linkedin" | "waterfall" | null = null;
      try {
        // Pour le moment seul job_type='contacts' est implemente.
        if (job.job_type !== "contacts") {
          throw new Error(`Job type "${job.job_type}" not implemented yet`);
        }

        // Routage contacts — TOUTES sources (Pappers ET Presse), Manus retiré :
        //   'linkedin'  -> enrich-contacts-linkedin (acheteurs opérationnels LinkedIn + Dropcontact) [défaut]
        //   'waterfall' -> enrich-contacts          (dirigeants légaux Pappers + Dropcontact)
        // Plus aucun routage vers trigger-manus-enrichment.
        const { data: boundRoute, error: routeError } = await supabase.rpc(
          "bind_enrichment_job_route",
          {
            p_job_id: job.id,
            p_lease_token: job.lease_token,
            p_requested_route: configuredEnrichmentProvider,
          },
        );
        const parsedBoundRoute = parseEnrichmentProviderRoute(boundRoute);
        if (routeError || !parsedBoundRoute) {
          throw new Error(
            `Enrichment route unavailable: ${routeError?.message || "invalid_bound_route"}`,
          );
        }
        enrichmentProvider = parsedBoundRoute;
        const targetFn = enrichmentProvider === "waterfall"
          ? "enrich-contacts"
          : "enrich-contacts-linkedin";

        const fnUrl = `${SUPABASE_URL}/functions/v1/${targetFn}`;
        const fnResponse = await fetchWithTimeout(fnUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            signal_id: job.signal_id,
            enrichment_job_id: job.id,
            enrichment_lease_token: job.lease_token,
          }),
        }, FETCH_TIMEOUT_MS);

        const parsedResult = await fnResponse.json().catch(() => ({}));
        const fnResult = parsedResult && typeof parsedResult === "object"
          ? parsedResult as Record<string, unknown>
          : {};
        const disposition = classifyEnrichmentInvocation(
          fnResponse.ok,
          fnResult,
        );
        if (disposition.kind === "retry") {
          throw new Error(
            disposition.reason ||
              (fnResponse.ok
                ? "Business result not completed"
                : `HTTP ${fnResponse.status}`),
          );
        }

        const asynchronous = disposition.kind === "running";
        const persisted = await updateLeasedJob(supabase, job, {
          status: asynchronous ? "running" : "completed",
          finished_at: asynchronous ? null : new Date().toISOString(),
          next_retry_at: null,
          error_message: null,
          result: {
            ...(job.result && typeof job.result === "object" ? job.result : {}),
            ...fnResult,
            provider_route: enrichmentProvider,
            operation_generation: job.id,
            submission_status: asynchronous ? "submitted" : "completed",
          },
          external_task_id: disposition.externalTaskId,
          lease_expires_at: asynchronous
            ? new Date(Date.now() + ASYNC_LEASE_MS).toISOString()
            : null,
          lease_owner: asynchronous ? job.lease_owner : null,
          lease_token: asynchronous ? job.lease_token : null,
        });
        if (!persisted) {
          console.warn(
            `[enrichment-worker] Lease lost before job ${job.id} result persistence`,
          );
          processed.push({
            job_id: job.id,
            signal_id: job.signal_id,
            result: "failed",
            error: "lease_lost",
          });
          continue;
        }

        processed.push({
          job_id: job.id,
          signal_id: job.signal_id,
          result: "started",
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[enrichment-worker] Job ${job.id} failed:`, errMsg);

        const shouldRetry = job.attempts < job.max_attempts;
        const updates: Record<string, unknown> = {
          error_message: errMsg,
          result: {
            ...(job.result && typeof job.result === "object" ? job.result : {}),
            ...(enrichmentProvider ? { provider_route: enrichmentProvider } : {}),
            operation_generation: job.id,
            submission_status: "failed",
            last_error: errMsg,
          },
          lease_owner: null,
          lease_token: null,
          lease_expires_at: null,
        };

        if (shouldRetry) {
          updates.status = "pending";
          updates.next_retry_at = new Date(
            Date.now() + backoffDelayMs(job.attempts),
          ).toISOString();
          updates.finished_at = null;
        } else {
          updates.status = "failed";
          updates.next_retry_at = null;
          updates.finished_at = new Date().toISOString();
        }

        const persisted = await updateLeasedJob(supabase, job, updates);
        if (!persisted) {
          console.warn(
            `[enrichment-worker] Lease lost before job ${job.id} retry persistence`,
          );
        }

        processed.push({
          job_id: job.id,
          signal_id: job.signal_id,
          result: "failed",
          error: errMsg,
        });
      }
    }

    return new Response(
      JSON.stringify({
        processed_count: processed.length,
        processed,
        stale_recovery: "atomic_in_claim_rpc",
        max_concurrency: maxConcurrency,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(
      "[enrichment-worker] Error:",
      error instanceof Error ? error.message : error,
    );
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

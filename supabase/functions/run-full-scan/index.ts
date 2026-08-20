import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  buildPressResumePayload,
  parsePressScanResume,
  type PressScanLease,
  requirePressScanLease,
} from "../_shared/press-scan-lease.ts";
import { interpretPressFetchResult } from "../_shared/press-news.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Keep a small pause to avoid hitting model/provider rate limits.
const PAUSE_BETWEEN_BATCHES_MS = 1000;

// Supabase Edge Functions have a hard runtime limit; we auto-resume before hitting it.
const INVOCATION_BUDGET_MS = 85_000;
const INVOCATION_SAFETY_MARGIN_MS = 10_000;

// Tentatives par batch d'analyse avant d'échouer le scan complet
// (analyze-articles fait déjà ses propres retries côté Lovable AI).
const ANALYZE_MAX_ATTEMPTS = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * supabase.functions.invoke renvoie un message générique ("Edge Function
 * returned a non-2xx status code") ; le détail réel est dans error.context.
 */
async function describeInvokeError(error: unknown): Promise<string> {
  const base = error instanceof Error ? error.message : String(error);
  const context = (error as { context?: Response }).context;
  if (context && typeof context.text === "function") {
    try {
      const body = await context.text();
      if (body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.error) return `${base} (${parsed.error})`;
        } catch {
          // corps non JSON : on le renvoie brut
        }
        return `${base} (${body.slice(0, 300)})`;
      }
    } catch {
      // corps illisible : on garde le message générique
    }
  }
  return base;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Service role for backend-only orchestration.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
  });

  const body = req.method === "POST"
    ? await req.json().catch(() => ({})) as Record<string, unknown>
    : {};
  let resumeLease: PressScanLease | null;
  try {
    resumeLease = parsePressScanResume(body);
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  // Toute reprise saute nécessairement le fetch : un détenteur de bail ne doit
  // pas pouvoir relancer les appels NewsAPI du début par une option incohérente.
  const skipFetch = resumeLease !== null || Boolean(body.skip_fetch);
  const fetchPartialErrorFromBody = typeof body.fetch_partial_error === "string"
    ? body.fetch_partial_error
    : null;

  const ensureScanLog = async (): Promise<{
    id: string;
    leaseToken: string | null;
    shouldStart: boolean;
  }> => {
    const { data, error } = await supabase.rpc("claim_press_scan", {
      p_scan_log_id: resumeLease?.scanLogId || null,
      p_lease_token: resumeLease?.leaseToken || null,
      p_lease_seconds: 600,
    });
    if (error || !data?.id) {
      throw new Error(
        `Impossible de réclamer le run Presse: ${
          error?.message || "réponse vide"
        }`,
      );
    }
    const shouldStart = Boolean(data.should_start);
    if (!shouldStart) {
      return { id: String(data.id), leaseToken: null, shouldStart: false };
    }
    const claimedLease = requirePressScanLease(
      { scan_log_id: data.id, lease_token: data.lease_token },
      "scan_log_id",
    );
    return {
      id: claimedLease.scanLogId,
      leaseToken: claimedLease.leaseToken,
      shouldStart: true,
    };
  };

  const runWork = async (scanLogId: string, leaseToken: string) => {
    const invocationStartedAt = Date.now();

    const updateScanLog = async (patch: Record<string, unknown>) => {
      const status = typeof patch.status === "string" ? patch.status : null;
      const now = new Date();
      const truthfulPatch: Record<string, unknown> = {
        ...patch,
        heartbeat_at: now.toISOString(),
        lease_expires_at: status && status !== "running"
          ? null
          : new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
        ...(status && status !== "running" ? { lease_token: null } : {}),
      };
      const { data, error } = await supabase
        .from("scan_logs")
        .update(truthfulPatch)
        .eq("id", scanLogId)
        .eq("lease_token", leaseToken)
        .eq("status", "running")
        .gt("lease_expires_at", now.toISOString())
        .select("id")
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          `Bail Presse perdu avant écriture du scan: ${
            error?.message || scanLogId
          }`,
        );
      }
    };

    try {
      console.log(
        "Starting full scan, log id:",
        scanLogId,
        "skip_fetch:",
        skipFetch,
      );

      // GR-011: marquer le cron_state comme 'running' au debut.
      await supabase.rpc("cron_state_run_start", {
        p_job_name: "scan-every-4-hours",
      }).then(
        () => {}, // best-effort
        (err) =>
          console.warn(
            "[run-full-scan] cron_state_run_start failed:",
            err?.message,
          ),
      );

      // Load current totals (important for auto-resume).
      const { data: existingLog, error: existingLogError } = await supabase
        .from("scan_logs")
        .select("articles_fetched, articles_analyzed, signals_created")
        .eq("id", scanLogId)
        .eq("lease_token", leaseToken)
        .eq("status", "running")
        .gt("lease_expires_at", new Date().toISOString())
        .single();
      if (existingLogError || !existingLog) {
        throw new Error(
          `Run Presse illisible: ${existingLogError?.message || scanLogId}`,
        );
      }

      let totalArticlesProcessed = Number(existingLog?.articles_analyzed ?? 0);
      let totalSignalsCreated = Number(existingLog?.signals_created ?? 0);
      let articlesFetched = Number(existingLog?.articles_fetched ?? 0);
      let fetchPartialError: string | null = fetchPartialErrorFromBody;

      // Step 1: Fetch news (only on the first invocation)
      if (!skipFetch) {
        console.log("Step 1: Fetching news...");
        await updateScanLog({ status: "running" });
        const { data: fetchResult, error: fetchError } = await supabase
          .functions.invoke("fetch-news", {
            body: { run_id: scanLogId },
            headers: { Authorization: `Bearer ${serviceRoleKey}` },
          });

        if (fetchError) {
          throw new Error(`Fetch failed: ${fetchError.message}`);
        }

        const fetchOutcome = interpretPressFetchResult(fetchResult);
        if (!fetchOutcome.canAnalyzeExistingArticles) {
          throw new Error(`Fetch failed: ${fetchOutcome.terminalError}`);
        }

        if (fetchOutcome.terminalError) {
          fetchPartialError = fetchOutcome.terminalError;
          console.error(fetchPartialError, fetchResult);
        }

        console.log("Fetch result:", fetchResult);

        // The backend stores "new_articles_saved" as the fetched count.
        articlesFetched = Number(fetchResult?.new_articles_saved ?? 0);
        await updateScanLog({
          articles_fetched: articlesFetched,
          status: "running",
          error_message: null,
        });

        // Pause to let inserts complete.
        await sleep(2000);
      }

      // Step 2: Analyze until there are no more unprocessed articles.
      console.log("Step 2: Analyzing articles in batches until completion...");

      let batchNumber = 0;
      while (true) {
        batchNumber += 1;
        console.log(`Starting batch ${batchNumber}...`);

        let analyzeResult: Record<string, unknown> | null = null;
        let lastAnalyzeError = "Unknown error";

        for (let attempt = 1; attempt <= ANALYZE_MAX_ATTEMPTS; attempt++) {
          await updateScanLog({ status: "running" });
          const { data, error: analyzeError } = await supabase.functions.invoke(
            "analyze-articles",
            {
              body: { run_id: scanLogId, lease_token: leaseToken },
              headers: { Authorization: `Bearer ${serviceRoleKey}` },
            },
          );

          if (!analyzeError && data?.success) {
            analyzeResult = data;
            break;
          }

          lastAnalyzeError = analyzeError
            ? await describeInvokeError(analyzeError)
            : data?.error || "Unknown error";
          console.error(
            `Batch ${batchNumber} attempt ${attempt}/${ANALYZE_MAX_ATTEMPTS} failed: ${lastAnalyzeError}`,
          );

          if (attempt < ANALYZE_MAX_ATTEMPTS) {
            await sleep(2000 * attempt);
          }
        }

        if (!analyzeResult) {
          throw new Error(`Analyze failed: ${lastAnalyzeError}`);
        }

        const articlesProcessed = Number(
          analyzeResult?.articles_processed ?? 0,
        );
        const signalsCreated = Number(analyzeResult?.signals_created ?? 0);

        totalArticlesProcessed += articlesProcessed;
        totalSignalsCreated += signalsCreated;

        await updateScanLog({
          status: "running",
          articles_analyzed: totalArticlesProcessed,
          signals_created: totalSignalsCreated,
        });

        if (analyzeResult?.partial) {
          throw new Error(
            `Analyze partiel: ${
              Number(analyzeResult?.articles_retryable ?? 0)
            } article(s) en reprise, ` +
              `${
                Number(analyzeResult?.articles_dead_lettered ?? 0)
              } en dead-letter à revoir`,
          );
        }

        console.log(
          `Batch ${batchNumber} complete: ${articlesProcessed} articles, ${signalsCreated} signals (totals: ${totalArticlesProcessed} / ${totalSignalsCreated})`,
        );

        // Stop when all articles are processed.
        if (articlesProcessed === 0) {
          console.log("No more articles to process");
          if (fetchPartialError) {
            throw new Error(fetchPartialError);
          }
          await updateScanLog({
            completed_at: new Date().toISOString(),
            status: "completed",
            articles_analyzed: totalArticlesProcessed,
            signals_created: totalSignalsCreated,
          });
          // GR-011: marquer le cron_state comme completed.
          await supabase.rpc("cron_state_run_end", {
            p_job_name: "scan-every-4-hours",
            p_status: "completed",
            p_duration_ms: Date.now() - invocationStartedAt,
            p_error: null,
          }).then(() => {}, () => {});
          console.log(
            `Full scan completed: ${batchNumber} batches, ${totalArticlesProcessed} articles analyzed, ${totalSignalsCreated} signals created`,
          );
          break;
        }

        // Auto-resume before hitting the edge runtime limit.
        const elapsed = Date.now() - invocationStartedAt;
        const remaining = INVOCATION_BUDGET_MS - elapsed;
        if (remaining <= INVOCATION_SAFETY_MARGIN_MS) {
          console.log(
            `Approaching runtime limit (elapsed=${elapsed}ms). Scheduling resume for scan_log_id=${scanLogId}...`,
          );

          const { error: resumeError } = await supabase.functions.invoke(
            "run-full-scan",
            {
              body: buildPressResumePayload(
                { scanLogId, leaseToken },
                fetchPartialError,
              ),
              headers: { Authorization: `Bearer ${serviceRoleKey}` },
            },
          );

          if (resumeError) {
            throw new Error(
              `Failed to schedule resume: ${resumeError.message}`,
            );
          }

          // Don't mark completed; next invocation continues.
          return;
        }

        await sleep(PAUSE_BETWEEN_BATCHES_MS);
      }
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : "Unknown error";
      console.error("Error in run-full-scan:", error);

      try {
        await updateScanLog({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: errorMessage,
        });
      } catch (failureWriteError) {
        console.error(
          "Failed to persist terminal scan failure:",
          failureWriteError instanceof Error
            ? failureWriteError.message
            : failureWriteError,
        );
      }

      // GR-011: marquer le cron_state comme failed.
      await supabase.rpc("cron_state_run_end", {
        p_job_name: "scan-every-4-hours",
        p_status: "failed",
        p_duration_ms: Date.now() - invocationStartedAt,
        p_error: errorMessage.slice(0, 500),
      }).then(() => {}, () => {});
    }
  };

  try {
    const { id: scanLogId, leaseToken, shouldStart } = await ensureScanLog();

    // Run in the background so the HTTP request can return immediately.
    // This avoids timeouts while still processing all pending articles.
    if (shouldStart && leaseToken) {
      const edgeRuntime = (globalThis as typeof globalThis & {
        EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void };
      }).EdgeRuntime;
      if (typeof edgeRuntime?.waitUntil === "function") {
        edgeRuntime.waitUntil(runWork(scanLogId, leaseToken));
      } else {
        // Fallback (e.g. local): start async without blocking the response.
        runWork(scanLogId, leaseToken);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        scan_log_id: scanLogId,
        status: "running",
        message: shouldStart
          ? "Scan started; analysis will continue until completion."
          : "A scan is already running; no duplicate provider call was started.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    console.error("Error starting run-full-scan:", error);

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

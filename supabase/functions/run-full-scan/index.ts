import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Keep a small pause to avoid hitting model/provider rate limits.
const PAUSE_BETWEEN_BATCHES_MS = 1000;

// Supabase Edge Functions have a hard runtime limit; we auto-resume before hitting it.
const INVOCATION_BUDGET_MS = 85_000;
const INVOCATION_SAFETY_MARGIN_MS = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ScanWorkArgs = {
  scan_log_id?: string;
  skip_fetch?: boolean;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Service role for backend-only orchestration.
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
  });

  const body: ScanWorkArgs = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const scanLogIdFromBody = body?.scan_log_id;
  const skipFetch = Boolean(body?.skip_fetch);

  const ensureScanLog = async (): Promise<string> => {
    if (scanLogIdFromBody) return scanLogIdFromBody;

    const { data: scanLog, error: logError } = await supabase
      .from("scan_logs")
      .insert({ status: "running" })
      .select("id")
      .single();

    if (logError || !scanLog?.id) {
      console.error("Error creating scan log:", logError);
      throw new Error("Failed to create scan log");
    }

    return scanLog.id as string;
  };

  const runWork = async (scanLogId: string) => {
    const invocationStartedAt = Date.now();

    const updateScanLog = async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("scan_logs").update(patch).eq("id", scanLogId);
      if (error) console.error("Error updating scan log:", error);
    };

    try {
      console.log("Starting full scan, log id:", scanLogId, "skip_fetch:", skipFetch);

      // Load current totals (important for auto-resume).
      const { data: existingLog } = await supabase
        .from("scan_logs")
        .select("articles_fetched, articles_analyzed, signals_created")
        .eq("id", scanLogId)
        .single();

      let totalArticlesProcessed = Number(existingLog?.articles_analyzed ?? 0);
      let totalSignalsCreated = Number(existingLog?.signals_created ?? 0);
      let articlesFetched = Number(existingLog?.articles_fetched ?? 0);

      // Step 1: Fetch news (only on the first invocation)
      if (!skipFetch) {
        console.log("Step 1: Fetching news...");
        const { data: fetchResult, error: fetchError } = await supabase.functions.invoke("fetch-news", {
          body: {},
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
        });

        if (fetchError) {
          throw new Error(`Fetch failed: ${fetchError.message}`);
        }

        if (!fetchResult?.success) {
          throw new Error(`Fetch failed: ${fetchResult?.error || "Unknown error"}`);
        }

        console.log("Fetch result:", fetchResult);

        // The backend stores "new_articles_saved" as the fetched count.
        articlesFetched = Number(fetchResult?.new_articles_saved ?? 0);
        await updateScanLog({ articles_fetched: articlesFetched, status: "running", error_message: null });

        // Pause to let inserts complete.
        await sleep(2000);
      }

      // Step 2: Analyze until there are no more unprocessed articles.
      console.log("Step 2: Analyzing articles in batches until completion...");

      let batchNumber = 0;
      while (true) {
        batchNumber += 1;
        console.log(`Starting batch ${batchNumber}...`);

        const { data: analyzeResult, error: analyzeError } = await supabase.functions.invoke("analyze-articles", {
          body: {},
          headers: { Authorization: `Bearer ${serviceRoleKey}` },
        });

        if (analyzeError) {
          throw new Error(`Analyze failed: ${analyzeError.message}`);
        }

        if (!analyzeResult?.success) {
          throw new Error(`Analyze failed: ${analyzeResult?.error || "Unknown error"}`);
        }

        const articlesProcessed = Number(analyzeResult?.articles_processed ?? 0);
        const signalsCreated = Number(analyzeResult?.signals_created ?? 0);

        totalArticlesProcessed += articlesProcessed;
        totalSignalsCreated += signalsCreated;

        await updateScanLog({
          status: "running",
          articles_analyzed: totalArticlesProcessed,
          signals_created: totalSignalsCreated,
        });

        console.log(
          `Batch ${batchNumber} complete: ${articlesProcessed} articles, ${signalsCreated} signals (totals: ${totalArticlesProcessed} / ${totalSignalsCreated})`,
        );

        // Stop when all articles are processed.
        if (articlesProcessed === 0) {
          console.log("No more articles to process");
          await updateScanLog({
            completed_at: new Date().toISOString(),
            status: "completed",
            articles_analyzed: totalArticlesProcessed,
            signals_created: totalSignalsCreated,
          });
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

          const { error: resumeError } = await supabase.functions.invoke("run-full-scan", {
            body: { scan_log_id: scanLogId, skip_fetch: true },
            headers: { Authorization: `Bearer ${serviceRoleKey}` },
          });

          if (resumeError) {
            throw new Error(`Failed to schedule resume: ${resumeError.message}`);
          }

          // Don't mark completed; next invocation continues.
          return;
        }

        await sleep(PAUSE_BETWEEN_BATCHES_MS);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("Error in run-full-scan:", error);

      await supabase
        .from("scan_logs")
        .update({
          completed_at: new Date().toISOString(),
          status: "failed",
          error_message: errorMessage,
        })
        .eq("id", scanLogId);
    }
  };

  try {
    const scanLogId = await ensureScanLog();

    // Run in the background so the HTTP request can return immediately.
    // This avoids timeouts while still processing all pending articles.
    // deno-lint-ignore no-explicit-any
    const canWaitUntil = typeof (globalThis as any).EdgeRuntime?.waitUntil === "function";
    if (canWaitUntil) {
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime.waitUntil(runWork(scanLogId));
    } else {
      // Fallback (e.g. local): start async without blocking the response.
      runWork(scanLogId);
    }

    return new Response(
      JSON.stringify({
        success: true,
        scan_log_id: scanLogId,
        status: "running",
        message: "Scan started; analysis will continue until completion.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error starting run-full-scan:", error);

    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


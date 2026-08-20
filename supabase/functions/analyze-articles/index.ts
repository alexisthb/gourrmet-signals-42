import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPressGeographyInstruction,
  initialPressProviderUsage,
  parsePressAnalysisResponse,
  partitionPressClaimOutcome,
  summarizePressBacklog,
} from "../_shared/press-analysis.ts";
import { canonicalizeArticleUrl } from "../_shared/press-news.ts";
import { requirePressScanLease } from "../_shared/press-scan-lease.ts";
import { extractLovableAITokenUsage } from "../_shared/lovable-ai-usage.ts";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const REVENUE_FLOOR = 1_000_000; // 1M€ plancher absolu

// Bascule sur Lovable AI Gateway (Gemini 3.1) — plus de dépendance crédits Anthropic
const AI_MODEL = "google/gemini-3.1-pro-preview";
const AI_MAX_TOKENS = 8192;
const AI_MAX_ATTEMPTS = 3;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

type ClaimedPressArticle = {
  id: string;
  attempt_count: number;
  claim_token: string;
  title: string;
  source_name: string | null;
  published_at: string | null;
  description: string | null;
  content: string | null;
  url: string;
};

type MeteredProvider = "lovable_ai" | "perplexity";
type ProviderAttemptRecorder = (event: {
  provider: MeteredProvider;
  operation: string;
  success: boolean;
  errorCode: string | null;
  itemsCount: number;
  metadata: Record<string, unknown>;
}) => Promise<string>;
type ProviderAttemptUpdater = (
  provider: MeteredProvider,
  requestKey: string,
  patch: {
    success?: boolean;
    error_code?: string | null;
    requests_count?: number;
    dispatch_status?: "unconfirmed" | "confirmed" | "reconciled_no_charge";
    metadata?: Record<string, unknown>;
    units?: number;
    signal_id?: string | null;
  },
) => Promise<void>;

class ProviderLedgerFailure extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ProviderLedgerFailure";
  }
}

/**
 * Appelle Lovable AI Gateway (OpenAI-compatible) avec retry sur 429/5xx.
 */
async function callAIWithRetry(
  apiKey: string,
  body: Record<string, unknown>,
  itemsCount: number,
  recordAttempt: ProviderAttemptRecorder,
  updateAttempt: ProviderAttemptUpdater,
): Promise<{ response: Response; requestKey: string }> {
  let lastError = "AI Gateway error: unknown";
  for (let attempt = 1; attempt <= AI_MAX_ATTEMPTS; attempt++) {
    const requestKey = await recordAttempt({
      provider: "lovable_ai",
      operation: "analyze_press_articles",
      success: false,
      errorCode: "dispatch_unconfirmed",
      itemsCount,
      metadata: { attempt, model: AI_MODEL },
    });
    let response: Response;
    try {
      response = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );
    } catch (error) {
      lastError = `AI Gateway dispatch non confirmé (${requestKey}): ${
        error instanceof Error ? error.message : String(error)
      }`;
      break;
    }

    await updateAttempt("lovable_ai", requestKey, {
      success: response.ok,
      error_code: response.ok ? null : `http_${response.status}`,
      requests_count: 1,
      ...(response.ok ? {} : { dispatch_status: "confirmed" as const }),
      metadata: {
        attempt,
        model: AI_MODEL,
        measurement_quality: "provider_response_observed",
      },
    });

    if (response.ok) return { response, requestKey };

    const errorText = await response.text();
    lastError = `AI Gateway error: ${response.status} - ${
      errorText.slice(0, 300)
    }`;

    if (response.status === 402) {
      throw new Error(
        "Crédits Lovable AI épuisés. Ajoutez des crédits dans Settings → Workspace → Usage.",
      );
    }

    const isRetryable = response.status === 429 || response.status >= 500;
    if (!isRetryable || attempt === AI_MAX_ATTEMPTS) break;

    const delayMs = 2000 * 2 ** (attempt - 1);
    console.warn(
      `[analyze-articles] ${lastError} - nouvel essai dans ${delayMs}ms (tentative ${attempt}/${AI_MAX_ATTEMPTS})`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(lastError);
}

/**
 * Estime le CA basé sur l'effectif (en euros)
 */
function estimateRevenueFromEmployees(employeeCount: number): number {
  if (!employeeCount || employeeCount <= 0) return 0;

  if (employeeCount < 50) {
    return employeeCount * 100_000;
  } else if (employeeCount <= 250) {
    return employeeCount * 120_000;
  } else {
    return employeeCount * 150_000;
  }
}

// === Normalisation défensive avant insert ===
// Le modèle IA renvoie parfois des variantes hors des listes autorisées par les CHECK
// de la table signals (signal_type, estimated_size, score). Une valeur hors-liste faisait
// échouer l'INSERT en silence (erreur loggée, signal PERDU, article quand même marqué
// processed -> jamais réanalysé). On ramène chaque champ à sa valeur canonique.
const SIGNAL_TYPE_MAP: Record<string, string> = {
  anniversaire: "anniversaire",
  anniversary: "anniversaire",
  jubile: "anniversaire",
  "jubilé": "anniversaire",
  centenaire: "anniversaire",
  levee: "levee",
  "levée": "levee",
  funding: "levee",
  fundraising: "levee",
  "levee de fonds": "levee",
  "levée de fonds": "levee",
  "tour de table": "levee",
  ma: "ma",
  "m&a": "ma",
  acquisition: "ma",
  fusion: "ma",
  rachat: "ma",
  merger: "ma",
  rapprochement: "ma",
  distinction: "distinction",
  prix: "distinction",
  award: "distinction",
  classement: "distinction",
  label: "distinction",
  certification: "distinction",
  palmares: "distinction",
  "palmarès": "distinction",
  expansion: "expansion",
  ouverture: "expansion",
  implantation: "expansion",
  inauguration: "expansion",
  nomination: "nomination",
  appointment: "nomination",
  dirigeant: "nomination",
};

// Vrai si `word` apparaît dans `phrase` en tant que MOT ENTIER (bornes = début/fin de
// chaîne ou caractère non-lettre). Évite le piège des sous-chaînes : la clé 'ma' (2 lettres)
// matchait dans 'marché'/'management'/'palmarès' -> faux M&A. Gère les accents (contrairement
// au \b ASCII qui casse sur 'jubilé', 'levée'...).
function containsWholeWord(phrase: string, word: string): boolean {
  const isLetter = (c: string) => c !== "" && /[a-zà-ÿ]/i.test(c);
  let from = 0;
  for (;;) {
    const idx = phrase.indexOf(word, from);
    if (idx === -1) return false;
    const before = idx === 0 ? "" : phrase[idx - 1];
    const after = idx + word.length >= phrase.length
      ? ""
      : phrase[idx + word.length];
    if (!isLetter(before) && !isLetter(after)) return true;
    from = idx + 1;
  }
}

function normalizeSignalType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (SIGNAL_TYPE_MAP[key]) return SIGNAL_TYPE_MAP[key];
  // Repli sur mot entier (ex: "levée de fonds série B" -> levee, "M&A / fusion" -> ma),
  // SANS la sous-chaîne qui confondait 'ma' avec 'marché'/'management'/'palmarès'.
  for (const [k, v] of Object.entries(SIGNAL_TYPE_MAP)) {
    if (containsWholeWord(key, k)) return v;
  }
  return null;
}

function normalizeEstimatedSize(raw: unknown): string {
  if (typeof raw !== "string") return "Inconnu";
  const key = raw.trim().toLowerCase();
  if (key === "pme") return "PME";
  if (key === "eti") return "ETI";
  if (key.includes("grand")) return "Grand Compte"; // "Grand Compte", "grand-compte"...
  return "Inconnu"; // TPE, Startup, GE, vide -> Inconnu (valeur autorisée par le CHECK)
}

function clampScore(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n))); // entier 1..5 (CHECK score BETWEEN 1 AND 5)
}

/**
 * Appelle Perplexity pour trouver le CA d'une entreprise
 */
async function fetchRevenueFromPerplexity(
  companyName: string,
  articleId: string,
  recordAttempt: ProviderAttemptRecorder,
  updateAttempt: ProviderAttemptUpdater,
): Promise<{
  revenue: number | null;
  source: "perplexity" | "not_found";
  tokensUsed: number | null;
  requestKey: string | null;
  needsFinalization: boolean;
}> {
  if (!PERPLEXITY_API_KEY) {
    console.log("[analyze-articles] Perplexity API key not configured");
    return {
      revenue: null,
      source: "not_found",
      tokensUsed: null,
      requestKey: null,
      needsFinalization: false,
    };
  }

  const requestKey = await recordAttempt({
    provider: "perplexity",
    operation: "press_revenue_lookup",
    success: false,
    errorCode: "dispatch_unconfirmed",
    itemsCount: 1,
    metadata: {
      article_id: articleId,
      company_name: companyName,
      model: "sonar",
    },
  });
  let response: Response;
  try {
    response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "Tu es un assistant qui recherche des informations financières sur les entreprises françaises. Réponds UNIQUEMENT en JSON valide, sans markdown.",
          },
          {
            role: "user",
            content:
              `Recherche le chiffre d'affaires annuel le plus récent de l'entreprise "${companyName}" en France.

Réponds UNIQUEMENT avec ce JSON (sans markdown ni texte):
{
  "company": "nom exact trouvé",
  "revenue_euros": nombre en euros (sans symbole, ex: 50000000 pour 50M€),
  "year": année du CA,
  "confidence": "high" | "medium" | "low",
  "source": "source de l'info"
}

Si tu ne trouves pas le CA, réponds:
{"company": "${companyName}", "revenue_euros": null, "confidence": "none", "source": null}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.1,
      }),
    });
  } catch (error) {
    console.error("[analyze-articles] Error calling Perplexity:", error);
    throw new ProviderLedgerFailure(
      `Dispatch Perplexity non confirmé (${requestKey}); réconciliation requise`,
      { cause: error },
    );
  }

  await updateAttempt("perplexity", requestKey, {
    success: response.ok,
    error_code: response.ok ? null : `http_${response.status}`,
    requests_count: 1,
    ...(response.ok ? {} : { dispatch_status: "confirmed" as const }),
    metadata: {
      article_id: articleId,
      company_name: companyName,
      model: "sonar",
      measurement_quality: "provider_response_observed",
    },
  });

  if (!response.ok) {
    console.error("[analyze-articles] Perplexity API error:", response.status);
    return {
      revenue: null,
      source: "not_found",
      tokensUsed: null,
      requestKey,
      needsFinalization: false,
    };
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    await updateAttempt("perplexity", requestKey, {
      success: false,
      error_code: "invalid_json",
      dispatch_status: "confirmed",
    });
    return {
      revenue: null,
      source: "not_found",
      tokensUsed: null,
      requestKey,
      needsFinalization: false,
    };
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const firstChoice = choices[0] && typeof choices[0] === "object"
    ? choices[0] as Record<string, unknown>
    : null;
  const message =
    firstChoice?.message && typeof firstChoice.message === "object"
      ? firstChoice.message as Record<string, unknown>
      : null;
  const content = typeof message?.content === "string" ? message.content : "";
  const usage = data.usage && typeof data.usage === "object"
    ? data.usage as Record<string, unknown>
    : null;
  const tokensUsed = typeof usage?.total_tokens === "number" &&
      Number.isFinite(usage.total_tokens)
    ? usage.total_tokens
    : null;
  console.log(
    `[analyze-articles] Perplexity response for ${companyName}:`,
    content.substring(0, 200),
  );

  try {
    const cleanedContent = content.replace(/```json\n?/g, "").replace(
      /```\n?/g,
      "",
    ).trim();
    const result = JSON.parse(cleanedContent) as Record<string, unknown>;
    if (
      typeof result.revenue_euros === "number" &&
      Number.isFinite(result.revenue_euros)
    ) {
      return {
        revenue: result.revenue_euros,
        source: "perplexity",
        tokensUsed,
        requestKey,
        needsFinalization: true,
      };
    }
    return {
      revenue: null,
      source: "not_found",
      tokensUsed,
      requestKey,
      needsFinalization: true,
    };
  } catch {
    await updateAttempt("perplexity", requestKey, {
      success: false,
      error_code: "invalid_result_json",
      units: tokensUsed ?? 0,
      dispatch_status: "confirmed",
    });
    return {
      revenue: null,
      source: "not_found",
      tokensUsed,
      requestKey,
      needsFinalization: false,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let failActiveClaim: ((errorMessage: string) => Promise<void>) | null = null;

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create service client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const requestBody = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const { scanLogId: runId, leaseToken } = requirePressScanLease(requestBody);
    let providerInvocationId = "uninitialized";
    let providerBusinessKey = "uninitialized";
    let providerArticleIds: string[] = [];
    let providerAttemptSequence = 0;

    const heartbeatPressScan = async (patch: Record<string, unknown> = {}) => {
      const now = new Date();
      const { data, error } = await supabase
        .from("scan_logs")
        .update({
          ...patch,
          heartbeat_at: now.toISOString(),
          lease_expires_at: new Date(now.getTime() + 10 * 60 * 1000)
            .toISOString(),
        })
        .eq("id", runId)
        .eq("lease_token", leaseToken)
        .eq("status", "running")
        .gt("lease_expires_at", now.toISOString())
        .select("id")
        .maybeSingle();
      if (error || !data) {
        throw new Error(
          `Bail Presse perdu pendant l'analyse: ${error?.message || runId}`,
        );
      }
    };

    // Aucun claim d'article ni appel fournisseur ne démarre si cette
    // invocation ne détient plus le token courant du run.
    await heartbeatPressScan();

    const { error: ledgerReadyError } = await supabase
      .from("provider_usage_events")
      .select("id")
      .limit(1);
    if (ledgerReadyError) {
      throw new ProviderLedgerFailure(
        `Provider ledger unavailable: ${ledgerReadyError.message}`,
      );
    }

    const { data: ambiguousDispatch, error: ambiguousDispatchError } =
      await supabase
        .from("provider_usage_events")
        .select("id,provider,operation")
        .eq("run_id", runId)
        .eq("dispatch_status", "unconfirmed")
        .in("provider", ["lovable_ai", "perplexity"])
        .limit(1)
        .maybeSingle();
    if (ambiguousDispatchError) {
      throw new ProviderLedgerFailure(
        `Provider dispatch state unavailable: ${ambiguousDispatchError.message}`,
      );
    }
    if (ambiguousDispatch) {
      throw new ProviderLedgerFailure(
        `Dispatch fournisseur non confirmé pour ce run (${ambiguousDispatch.provider}/${ambiguousDispatch.operation}); réconciliation manuelle requise`,
      );
    }

    const recordProviderAttempt: ProviderAttemptRecorder = async (event) => {
      providerAttemptSequence += 1;
      const initialUsage = initialPressProviderUsage(event.provider);
      const eventBusinessKey =
        typeof event.metadata.business_key === "string" &&
          event.metadata.business_key
          ? event.metadata.business_key
          : providerBusinessKey;
      const { data: unresolved, error: unresolvedError } = await supabase
        .from("provider_usage_events")
        .select("id")
        .eq("provider", event.provider)
        .eq("business_key", eventBusinessKey)
        .eq("dispatch_status", "unconfirmed")
        .limit(1)
        .maybeSingle();
      if (unresolvedError) {
        throw new ProviderLedgerFailure(
          `Provider dispatch lookup failed: ${unresolvedError.message}`,
        );
      }
      if (unresolved) {
        throw new ProviderLedgerFailure(
          `Dispatch fournisseur déjà ambigu pour ${eventBusinessKey}; réconciliation requise`,
        );
      }
      const requestKey = [
        event.provider,
        providerInvocationId,
        event.operation,
        providerAttemptSequence,
      ].join(":");
      const { error } = await supabase.from("provider_usage_events").insert({
        provider: event.provider,
        operation: event.operation,
        business_key: eventBusinessKey,
        run_id: runId,
        request_key: requestKey,
        units: initialUsage.units,
        requests_count: 0,
        items_count: event.itemsCount,
        cost_amount: null,
        success: false,
        error_code: "dispatch_unconfirmed",
        dispatch_status: "unconfirmed",
        metadata: {
          unit_name: initialUsage.unitName,
          measurement_quality: "dispatch_intent",
          invocation_id: providerInvocationId,
          business_key: eventBusinessKey,
          article_ids: providerArticleIds,
          sequence: providerAttemptSequence,
          ...event.metadata,
        },
      });
      if (error) {
        throw new ProviderLedgerFailure(
          `Provider ledger write failed: ${error.message}`,
          { cause: error },
        );
      }
      return requestKey;
    };

    const updateProviderAttempt: ProviderAttemptUpdater = async (
      provider,
      requestKey,
      patch,
    ) => {
      let mergedPatch = patch;
      if (patch.metadata) {
        const { data: current, error: currentError } = await supabase
          .from("provider_usage_events")
          .select("metadata")
          .eq("provider", provider)
          .eq("request_key", requestKey)
          .maybeSingle();
        if (currentError || !current) {
          throw new ProviderLedgerFailure(
            `Provider ledger metadata read failed: ${
              currentError?.message || "event not found"
            }`,
            { cause: currentError },
          );
        }
        const existingMetadata =
          current.metadata && typeof current.metadata === "object" &&
            !Array.isArray(current.metadata)
            ? current.metadata as Record<string, unknown>
            : {};
        mergedPatch = {
          ...patch,
          metadata: { ...existingMetadata, ...patch.metadata },
        };
      }

      const { data, error } = await supabase
        .from("provider_usage_events")
        .update(mergedPatch)
        .eq("provider", provider)
        .eq("request_key", requestKey)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        throw new ProviderLedgerFailure(
          `Provider ledger update failed: ${
            error?.message || "event not found"
          }`,
          { cause: error },
        );
      }
    };

    console.log("Starting analyze-articles function");

    // Get Lovable AI key from environment
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      throw new Error("LOVABLE_API_KEY is not configured in environment.");
    }

    // Get auto-enrich settings (read once at start)
    const { data: autoEnrichSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "auto_enrich_enabled")
      .maybeSingle();

    const { data: autoEnrichMinScoreSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "auto_enrich_min_score")
      .maybeSingle();

    const autoEnrichEnabled = autoEnrichSetting?.value !== "false";
    const autoEnrichMinScore = parseInt(
      autoEnrichMinScoreSetting?.value || "4",
      10,
    );
    console.log(
      `Auto-enrich enabled: ${autoEnrichEnabled}, min score: ${autoEnrichMinScore}`,
    );

    // Get min employees filter from settings
    const { data: minEmployeesSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "min_employees_presse")
      .maybeSingle();

    const minEmployees = parseInt(minEmployeesSetting?.value || "20", 10);
    console.log(`Min employees filter for Presse: ${minEmployees}`);

    // Get min revenue filter from settings (pour Presse)
    const { data: minRevenueSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "min_revenue_presse")
      .maybeSingle();

    const minRevenue = parseInt(
      minRevenueSetting?.value || String(REVENUE_FLOOR),
      10,
    );
    console.log(`Min revenue filter for Presse: ${minRevenue}€`);

    // Get Perplexity enrichment setting
    const { data: perplexityEnrichSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "perplexity_enrich_presse")
      .maybeSingle();

    const perplexityEnrichEnabled = perplexityEnrichSetting?.value !== "false";
    console.log(
      `Perplexity revenue enrichment enabled: ${perplexityEnrichEnabled}`,
    );

    // Les zones actives priorisent le scoring commercial, sans exclure le reste
    // de la France. Un échec de lecture ne rétablit jamais l'ancien filtre dur.
    const { data: priorityZones, error: priorityZonesError } = await supabase
      .from("geo_zones")
      .select("name,regions,cities")
      .eq("is_active", true)
      .gt("priority", 0)
      .lt("priority", 99)
      .order("priority", { ascending: true });
    if (priorityZonesError) {
      console.warn(
        "[analyze-articles] Priority zones unavailable; using France-wide coverage.",
      );
    }
    const geographyInstruction = buildPressGeographyInstruction(
      priorityZonesError ? [] : (priorityZones || []),
    );

    // Claim atomique : FOR UPDATE SKIP LOCKED côté RPC. Deux invocations
    // concurrentes ne peuvent plus analyser les mêmes articles.
    const { data: claimedRows, error: articlesError } = await supabase
      .rpc("claim_press_articles", { p_limit: 30 });

    if (articlesError) {
      console.error("Error claiming articles:", articlesError);
      throw articlesError;
    }

    const articles = (claimedRows || []) as ClaimedPressArticle[];
    if (articles.length === 0) {
      console.log("No articles to process");
      const { data: backlogMetrics, error: backlogError } = await supabase
        .from("press_article_backlog_metrics")
        .select(
          "ready,in_flight,retry_waiting,dead_lettered,exhausted_orphan,next_retry_at",
        )
        .single();
      if (backlogError || !backlogMetrics) {
        throw new Error(
          `Impossible de lire le backlog Presse: ${
            backlogError?.message || "réponse vide"
          }`,
        );
      }
      const backlog = summarizePressBacklog(backlogMetrics);
      return new Response(
        JSON.stringify({
          success: !backlog.hasOutstanding,
          partial: backlog.hasOutstanding,
          message: backlog.hasOutstanding
            ? "No article claimable; backlog Presse still requires processing or review"
            : "No articles to process",
          articles_processed: 0,
          articles_retryable: backlog.retryable,
          articles_ready: backlog.ready,
          articles_in_flight: backlog.inFlight,
          articles_retry_waiting: backlog.retryWaiting,
          articles_dead_lettered: backlog.deadLettered,
          articles_exhausted: backlog.exhausted,
          next_retry_at: backlog.nextRetryAt,
          signals_created: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const claimToken = articles[0]?.claim_token;
    const claimedArticleIds = articles.map((article) => article.id);
    providerArticleIds = [...claimedArticleIds].sort();
    if (
      typeof claimToken !== "string" ||
      claimedArticleIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("Invalid press claim returned by claim_press_articles");
    }
    if (articles.some((article) => article.claim_token !== claimToken)) {
      throw new Error("Press claim returned multiple claim tokens");
    }

    const failClaim = async (
      errorMessage: string,
      articleIds: string[] | null = null,
    ) => {
      const { error: failError } = await supabase.rpc("fail_press_articles", {
        p_claim_token: claimToken,
        p_error: errorMessage,
        p_article_ids: articleIds,
      });
      if (failError) {
        throw new Error(`Failed to release press claim: ${failError.message}`);
      }
    };
    const parkClaimForReconciliation = async (
      articleIds: string[],
      reason: string,
    ) => {
      if (articleIds.length === 0) return;
      const { data, error } = await supabase
        .from("raw_articles")
        .update({
          claim_token: null,
          claimed_at: null,
          next_retry_at: null,
          dead_lettered_at: new Date().toISOString(),
          dead_letter_reason: reason,
          last_error: reason,
        })
        .eq("claim_token", claimToken)
        .in("id", articleIds)
        .select("id");
      if (error || data?.length !== articleIds.length) {
        throw new Error(
          `Failed to park press articles for reconciliation: ${
            error?.message || `${data?.length ?? 0}/${articleIds.length}`
          }`,
        );
      }
    };
    failActiveClaim = (errorMessage: string) => failClaim(errorMessage);

    console.log(`Processing ${articles.length} articles`);

    // Prepare articles text for Lovable AI
    const articlesText = articles.map((a, i) =>
      `[ARTICLE ${i + 1}]
Titre: ${a.title}
Source: ${a.source_name || "Inconnue"}
Date: ${a.published_at || "Inconnue"}
Description: ${a.description || "N/A"}
Contenu: ${a.content || "N/A"}
URL: ${a.url}
`
    ).join("\n---\n\n");

    const prompt =
      `Tu es un assistant commercial expert pour Gourrmet, spécialiste français du cadeau d'affaires haut de gamme (chocolats Chapon, truffes Plantin, parfums Durance, cocktails ELY, coffrets Publicis Drugstore).

Ta mission : analyser des articles de presse économique française et identifier les "signaux Gourrmet" — des événements qui justifieraient qu'une entreprise fasse appel à Gourrmet pour offrir des cadeaux premium à ses équipes, clients ou partenaires.

${geographyInstruction}

## ⚠️ FILTRE EFFECTIFS OBLIGATOIRE

**MINIMUM ${minEmployees} SALARIÉS** : Ignorer toutes les entreprises ayant moins de ${minEmployees} salariés (sauf levée de fonds très importante >10M€).

## TYPES DE SIGNAUX À DÉTECTER

1. **anniversaire** : L'entreprise fête X ans d'existence, de présence en France, centenaire, jubilé, etc. C'est le signal le plus fort car l'entreprise VEUT célébrer.

2. **levee** : Levée de fonds significative (>5M€), tour de table, série A/B/C. Signal fort : l'entreprise a de l'argent et veut remercier/motiver.

3. **ma** : Acquisition, fusion, rapprochement, rachat, création d'un nouveau groupe. Signal fort : nouveau départ, intégration d'équipes.

4. **distinction** : Prix, classement, label, certification, palmarès ("meilleur employeur", "Best Lawyers", "Great Place to Work", "Legal 500", etc.). Signal très fort : l'entreprise veut célébrer sa reconnaissance.

5. **expansion** : Nouveau bureau, nouveau siège, nouvelle implantation, inauguration. Signal fort : événement à marquer.

6. **nomination** : Nouveau dirigeant (CEO, DG, Président). Signal plus faible mais peut être pertinent pour des cadeaux ciblés.

## CRITÈRES DE SCORING (1-5)

**Score 5** : Signal très fort (anniversaire rond, distinction majeure, grosse levée >20M€) + cible premium (avocat, conseil, finance, luxe, immobilier prestige) + grande entreprise (>200 employés estimés)

**Score 4** : Signal fort + bonne cible OU signal moyen + cible très premium

**Score 3** : Signal valide avec opportunité commerciale réelle, cible correcte

**Score 2** : Signal faible ou cible peu adaptée au haut de gamme (à ignorer)

**Score 1** : Non pertinent (à ignorer)

## FILTRE ICP (Ideal Customer Profile de Gourrmet)

**IGNORER absolument** :
- Entreprises de moins de ${minEmployees} salariés (sauf levée exceptionnelle >10M€)
- Associations, ONG, fondations
- Collectivités, administrations publiques
- Startups early stage (pré-seed, seed <3M€)
- Secteurs incompatibles : agriculture, BTP bas de gamme, discount, fast-food

**PRIORISER fortement** :
- Cabinets d'avocats d'affaires
- Cabinets de conseil (stratégie, management)
- Big Four et cabinets d'audit
- Banques privées, banques d'affaires
- Sociétés de gestion, Private Equity, Asset Management
- Luxe & cosmétiques (maisons, groupes)
- Immobilier haut de gamme (promotion, gestion)
- Pharma & santé (labos, biotech matures)
- Tech mature (scale-ups >50M€ levés, licornes, éditeurs)
- Assurances, mutuelles premium
- Hôtellerie & restauration haut de gamme

## FORMAT DE RÉPONSE

Réponds UNIQUEMENT en JSON valide, sans aucun texte avant ou après, sans markdown :

{
  "signals": [
    {
      "company_name": "Nom exact de l'entreprise tel que mentionné",
      "signal_type": "anniversaire|levee|ma|distinction|expansion|nomination",
      "event_detail": "Description factuelle et concise de l'événement (max 150 caractères)",
      "sector": "Secteur d'activité précis",
      "estimated_size": "PME|ETI|Grand Compte|Inconnu",
      "score": 5,
      "hook_suggestion": "Suggestion d'accroche personnalisée pour le message de prospection, mentionnant l'événement spécifique",
      "source_url": "URL exacte de l'article"
    }
  ],
  "articles_analyzed": 12,
  "signals_found": 3
}

**RÈGLES IMPORTANTES** :
- Ne retourne QUE les signaux avec score >= 3
- Un article peut contenir plusieurs signaux (plusieurs entreprises mentionnées)
- Si aucun signal pertinent : {"signals": [], "articles_analyzed": X, "signals_found": 0}
- Le hook_suggestion doit être en français, professionnel, personnalisé à l'événement
- Vérifie que source_url correspond bien à l'article analysé

---

ARTICLES À ANALYSER :

${articlesText}`;

    const promptDefinition = prompt.slice(
      0,
      prompt.indexOf("ARTICLES À ANALYSER :"),
    );
    const promptHash = await sha256Hex(promptDefinition);
    providerBusinessKey = await sha256Hex(
      [
        AI_MODEL,
        promptHash,
        ...providerArticleIds,
      ].join(":"),
    );
    const providerAttemptCycle = Math.max(
      1,
      ...articles.map((article) => Number(article.attempt_count || 1)),
    );
    providerInvocationId = `${providerBusinessKey}:${providerAttemptCycle}`;

    for (const articleId of providerArticleIds) {
      const { data: overlappingDispatch, error: overlappingDispatchError } =
        await supabase
          .from("provider_usage_events")
          .select("id,provider,operation")
          .eq("dispatch_status", "unconfirmed")
          .in("provider", ["lovable_ai", "perplexity"])
          .contains("metadata", { article_ids: [articleId] })
          .limit(1)
          .maybeSingle();
      if (overlappingDispatchError) {
        throw new ProviderLedgerFailure(
          `Provider dispatch state unavailable: ${overlappingDispatchError.message}`,
        );
      }
      if (overlappingDispatch) {
        throw new ProviderLedgerFailure(
          `Dispatch fournisseur non confirmé pour l'article ${articleId} (${overlappingDispatch.provider}/${overlappingDispatch.operation}); réconciliation manuelle requise`,
        );
      }
    }
    await heartbeatPressScan({
      detection_model_revision: AI_MODEL,
      detection_prompt_hash: promptHash,
    });

    console.log("Calling Lovable AI (Gemini 3.1) ...");

    const aiCall = await callAIWithRetry(
      lovableApiKey,
      {
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        response_format: { type: "json_object" },
        messages: [
          { role: "user", content: prompt },
        ],
      },
      articles.length,
      recordProviderAttempt,
      updateProviderAttempt,
    );

    let aiData: Record<string, unknown>;
    try {
      aiData = await aiCall.response.json();
    } catch {
      await updateProviderAttempt("lovable_ai", aiCall.requestKey, {
        success: false,
        error_code: "invalid_json",
        dispatch_status: "confirmed",
      });
      throw new Error("AI Gateway returned invalid JSON");
    }
    const lovableTokenUsage = extractLovableAITokenUsage(aiData);
    const finalizeLovableAttempt = async (
      success: boolean,
      errorCode: string | null,
    ) => {
      await updateProviderAttempt("lovable_ai", aiCall.requestKey, {
        success,
        error_code: errorCode,
        units: lovableTokenUsage.totalTokens ?? 0,
        dispatch_status: "confirmed",
        metadata: {
          model: AI_MODEL,
          unit_basis: lovableTokenUsage.totalTokens === null
            ? "tokens_not_returned"
            : "total_tokens",
          token_usage: lovableTokenUsage.fields,
          measurement_quality: "provider_response_consumed",
        },
      });
    };
    const aiChoices = Array.isArray(aiData.choices) ? aiData.choices : [];
    const aiFirstChoice = aiChoices[0] && typeof aiChoices[0] === "object"
      ? aiChoices[0] as Record<string, unknown>
      : null;
    const aiMessage =
      aiFirstChoice?.message && typeof aiFirstChoice.message === "object"
        ? aiFirstChoice.message as Record<string, unknown>
        : null;
    const responseText = typeof aiMessage?.content === "string"
      ? aiMessage.content
      : "";
    if (!responseText) {
      await finalizeLovableAttempt(false, "empty_response");
      throw new Error("AI Gateway returned an empty response");
    }

    // L'appel IA peut durer : revalider le fence avant toute écriture métier.
    await heartbeatPressScan();

    console.log("AI response received, parsing...");

    const parsedAnalysis = parsePressAnalysisResponse(
      responseText,
      articles.length,
    );
    if (!parsedAnalysis.ok) {
      // Contrat de vérité : le batch reste entièrement non traité. Le 502 force
      // run-full-scan à réessayer, au lieu de transformer une panne IA en zéro signal.
      console.error(
        `[analyze-articles] Invalid AI response (${parsedAnalysis.error}); batch kept for retry.`,
      );
      await finalizeLovableAttempt(false, parsedAnalysis.error);
      await failClaim(parsedAnalysis.error);
      failActiveClaim = null;
      return new Response(
        JSON.stringify({
          success: false,
          retryable: true,
          error: parsedAnalysis.error,
          articles_processed: 0,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const analysisSignals = parsedAnalysis.signals;
    console.log(`Analysis found ${analysisSignals.length} signals`);

    // Insert detected signals
    let signalsCreated = 0;
    let signalsFilteredByRevenue = 0;
    let autoEnrichedCount = 0;
    // Toute écriture échouée, quelle que soit la classe SQL, conserve l'article
    // en attente. Une erreur déterministe doit être visible et arbitrée, jamais
    // convertie silencieusement en article traité.
    const failedWriteArticleIds = new Set<string>();
    let analysisValidationFailed = false;

    const ensureAutoEnrichment = async (
      signalId: string,
      companyName: string,
      signalScore: number,
    ): Promise<boolean> => {
      if (!autoEnrichEnabled || signalScore < autoEnrichMinScore) return true;

      // Les contacts et l'enrichissement sont rattachés à un signal précis.
      // Un enrichissement récent de la même société sur un autre signal ne
      // couvre donc jamais celui-ci : il faut une file dédiée (dédupliquée par
      // signal côté RPC) pour que SignalDetail expose réellement ses contacts.
      const { data: enqueueResult, error: enqueueError } = await supabase.rpc(
        "enqueue_enrichment_job",
        {
          p_signal_id: signalId,
          p_job_type: "contacts",
          p_priority: Math.max(1, Math.min(10, Math.round(signalScore))),
          p_cooldown_seconds: 0,
        },
      );
      if (enqueueError) {
        console.error(
          `[analyze-articles] Atomic enrichment enqueue failed for ${companyName}:`,
          enqueueError,
        );
        return false;
      }

      const state = enqueueResult && typeof enqueueResult === "object"
        ? String((enqueueResult as Record<string, unknown>).state || "")
        : "";
      if (!["enqueued", "active"].includes(state)) {
        console.error(
          `[analyze-articles] Enrichment enqueue returned an invalid state for ${companyName}:`,
          state,
        );
        return false;
      }
      if (state === "enqueued") autoEnrichedCount++;
      return true;
    };

    for (const signal of analysisSignals) {
      // Les enrichissements CA peuvent allonger fortement un batch. Chaque
      // signal renouvelle donc le heartbeat et vérifie que le token n'a pas été
      // rotaté par une reprise plus récente.
      await heartbeatPressScan();
      if (
        typeof signal.company_name !== "string" ||
        signal.company_name.trim() === ""
      ) {
        console.error(
          "[analyze-articles] Signal without a company name; batch kept for retry.",
        );
        analysisValidationFailed = true;
        continue;
      }

      // Garde dure : le prompt demande "score >= 3" mais ne l'imposait qu'en consigne.
      // On rejette ici tout signal faible/invalide (1-2 etoiles ou score absent) avant insert.
      const score = clampScore(signal.score);
      if (score === null) {
        console.error(
          `[analyze-articles] Signal with invalid score "${signal.score}"; batch kept for retry.`,
        );
        analysisValidationFailed = true;
        continue;
      }
      if (score < 3) {
        console.log(
          `[analyze-articles] Signal ignore (score ${signal.score} < 3): ${signal.company_name}`,
        );
        continue;
      }

      // Normalisation type/taille : ramène les variantes du modèle aux valeurs autorisées
      // par les CHECK. Un type non reconnu = signal non catégorisable -> on l'ignore
      // plutôt que de tenter un INSERT qui violerait la contrainte.
      const signalType = normalizeSignalType(signal.signal_type);
      if (!signalType) {
        console.error(
          `[analyze-articles] Signal with unknown type "${signal.signal_type}"; batch kept for retry.`,
        );
        analysisValidationFailed = true;
        continue;
      }
      const estimatedSize = normalizeEstimatedSize(signal.estimated_size);

      const canonicalSourceUrl = canonicalizeArticleUrl(signal.source_url);
      const matchedArticle = canonicalSourceUrl
        ? articles.find((article) =>
          canonicalizeArticleUrl(article.url) === canonicalSourceUrl
        )
        : null;
      if (!matchedArticle) {
        console.error(
          "[analyze-articles] Signal source URL does not match this batch; batch kept for retry.",
        );
        analysisValidationFailed = true;
        continue;
      }

      // Check for duplicates
      const { data: existingSignal, error: duplicateLookupError } =
        await supabase
          .from("signals")
          .select("id, score")
          .eq("company_name", signal.company_name)
          .eq("source_url", canonicalSourceUrl)
          .limit(1)
          .maybeSingle();

      if (duplicateLookupError) {
        console.error("Error checking existing signal:", duplicateLookupError);
        failedWriteArticleIds.add(matchedArticle.id);
        continue;
      }

      if (!existingSignal) {
        // === FILTRE CA (ICP premium) ===
        // Estimation effectif -> CA, TOUJOURS calculée : sert de plancher même quand
        // Perplexity est désactivé/absent. Avant, tout le filtre CA était enfermé dans
        // le bloc Perplexity -> si Perplexity off, 100% des signaux passaient (TPE incluses).
        const sizeEstimates: Record<string, number> = {
          "PME": 50,
          "ETI": 300,
          "Grand Compte": 1000,
          "Inconnu": 100,
        };
        const estimatedEmployees = sizeEstimates[estimatedSize] || 100;
        const estimatedRevenue = estimateRevenueFromEmployees(
          estimatedEmployees,
        );

        let revenue: number | null = null;
        let revenueSource: "perplexity" | "estimated" | null = null;
        let meetsRevenueThreshold = true;
        let perplexityRequestKey: string | null = null;

        if (perplexityEnrichEnabled && PERPLEXITY_API_KEY) {
          console.log(
            `[analyze-articles] Fetching revenue for ${signal.company_name} via Perplexity...`,
          );

          const perplexityResult = await fetchRevenueFromPerplexity(
            signal.company_name,
            matchedArticle.id,
            recordProviderAttempt,
            updateProviderAttempt,
          );
          perplexityRequestKey = perplexityResult.requestKey;

          // Enregistrer l'usage Perplexity
          const { error: perplexityUsageError } = await supabase.from(
            "perplexity_usage",
          ).insert({
            query_type: "presse_revenue",
            company_name: signal.company_name,
            success: perplexityResult.revenue !== null,
            revenue_found: perplexityResult.revenue,
            revenue_source: perplexityResult.source,
            tokens_used: perplexityResult.tokensUsed,
          });
          if (perplexityUsageError) {
            throw new ProviderLedgerFailure(
              `Legacy Perplexity ledger write failed: ${perplexityUsageError.message}`,
              { cause: perplexityUsageError },
            );
          }
          if (
            perplexityResult.needsFinalization && perplexityResult.requestKey
          ) {
            await updateProviderAttempt(
              "perplexity",
              perplexityResult.requestKey,
              {
                success: true,
                error_code: null,
                units: perplexityResult.tokensUsed ?? 0,
                dispatch_status: "confirmed",
                metadata: {
                  article_id: matchedArticle.id,
                  company_name: signal.company_name,
                  model: "sonar",
                  unit_name: perplexityResult.tokensUsed === null
                    ? "tokens_not_returned"
                    : "tokens",
                  total_tokens: perplexityResult.tokensUsed,
                  measurement_quality: "provider_response_consumed",
                },
              },
            );
          }

          if (perplexityResult.revenue) {
            revenue = perplexityResult.revenue;
            revenueSource = "perplexity";
            console.log(
              `[analyze-articles] CA via Perplexity: ${revenue}€ pour ${signal.company_name}`,
            );
          } else {
            revenue = estimatedRevenue;
            revenueSource = "estimated";
            console.log(
              `[analyze-articles] Perplexity sans résultat, estimation ${signal.estimated_size} (${estimatedEmployees} emp): ${revenue}€`,
            );
          }
        } else {
          // Perplexity off/absent : on applique QUAND MÊME le plancher via l'estimation effectif.
          revenue = estimatedRevenue;
          revenueSource = "estimated";
          console.log(
            `[analyze-articles] Perplexity désactivé — plancher via estimation ${signal.estimated_size} (${estimatedEmployees} emp): ${revenue}€`,
          );
        }

        // Plancher CA appliqué dans TOUS les cas (Perplexity OU estimation).
        if (revenue !== null && revenue < minRevenue) {
          console.log(
            `[analyze-articles] ❌ CA ${revenue}€ < seuil ${minRevenue}€ pour ${signal.company_name} — IGNORÉ`,
          );
          meetsRevenueThreshold = false;
          signalsFilteredByRevenue++;
        }

        // Ne pas créer le signal si le CA est sous le seuil
        if (!meetsRevenueThreshold) {
          continue;
        }

        // signals.revenue est un BIGINT : on arrondit et borne le CA. Sans ça, une valeur
        // fractionnaire ou hors-plage (ex: Perplexity renvoyant 1234567.89 avec centimes)
        // provoque une erreur d'insert 22xxx -> signal perdu et article ré-analysé en boucle.
        const safeRevenue = (revenue != null && Number.isFinite(revenue))
          ? Math.max(0, Math.min(Math.round(revenue), 9_000_000_000_000))
          : null;

        // Plafond taille (décision produit Gourmet) : une petite entreprise ne doit JAMAIS
        // être classée 4/5. PME / Inconnu ne restent 4-5 QUE si le CA est costaud (>= 5 M€) ;
        // sinon plafond à 3. Effet : ça les sort de l'auto-enrichissement (déclenché à
        // score >= autoEnrichMinScore = 4), on n'enrichit donc que de vraies cibles.
        let finalScore = score;
        const SMALL_REVENUE_CAP = 5_000_000;
        if (
          (estimatedSize === "PME" || estimatedSize === "Inconnu") &&
          (safeRevenue == null || safeRevenue < SMALL_REVENUE_CAP)
        ) {
          finalScore = Math.min(finalScore, 3);
        }

        const { data: insertedSignal, error: insertError } = await supabase
          .from("signals")
          .insert({
            detection_run_id: runId,
            detection_model_revision: AI_MODEL,
            detection_prompt_hash: promptHash,
            article_id: matchedArticle?.id ?? null,
            company_name: signal.company_name,
            signal_type: signalType,
            event_detail: signal.event_detail,
            sector: signal.sector,
            estimated_size: estimatedSize,
            score: finalScore,
            hook_suggestion: signal.hook_suggestion,
            source_url: canonicalSourceUrl,
            source_name: matchedArticle?.source_name || null,
            revenue: safeRevenue,
            revenue_source: revenueSource,
          })
          .select("id")
          .single();

        if (!insertError && insertedSignal) {
          if (perplexityRequestKey) {
            await updateProviderAttempt("perplexity", perplexityRequestKey, {
              signal_id: insertedSignal.id,
            });
          }
          signalsCreated++;
          if (
            !(await ensureAutoEnrichment(
              insertedSignal.id,
              signal.company_name,
              finalScore,
            ))
          ) {
            failedWriteArticleIds.add(matchedArticle.id);
          }
        } else {
          console.error(
            "Error inserting signal:",
            insertError ?? "insert returned no row",
          );
          failedWriteArticleIds.add(matchedArticle.id);
        }
      } else if (
        !(await ensureAutoEnrichment(
          existingSignal.id,
          signal.company_name,
          Number(existingSignal.score ?? score),
        ))
      ) {
        // A retry can now repair the durable signal -> queue handoff instead
        // of considering a duplicate signal sufficient proof of completion.
        failedWriteArticleIds.add(matchedArticle.id);
      }
    }

    if (analysisValidationFailed) {
      await finalizeLovableAttempt(false, "signal_source_not_in_batch");
      await failClaim("signal_source_not_in_batch");
      failActiveClaim = null;
      return new Response(
        JSON.stringify({
          success: false,
          retryable: true,
          error: "signal_source_not_in_batch",
          articles_processed: 0,
        }),
        {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const claimOutcome = partitionPressClaimOutcome(
      claimedArticleIds,
      failedWriteArticleIds,
      true,
    );
    if (claimOutcome.completeIds.length > 0) {
      const { error: completeError } = await supabase.rpc(
        "complete_press_articles",
        {
          p_claim_token: claimToken,
          p_article_ids: claimOutcome.completeIds,
        },
      );
      if (completeError) {
        throw new Error(
          `Failed to complete press claim: ${completeError.message}`,
        );
      }
    }
    if (claimOutcome.retryIds.length > 0) {
      await parkClaimForReconciliation(
        claimOutcome.retryIds,
        "business_persistence_incomplete",
      );
    }
    failActiveClaim = null;

    if (failedWriteArticleIds.size > 0) {
      await updateProviderAttempt("lovable_ai", aiCall.requestKey, {
        success: false,
        error_code: "business_persistence_incomplete",
        metadata: {
          provider_response_observed: true,
          observed_total_tokens: lovableTokenUsage.totalTokens,
          token_usage: lovableTokenUsage.fields,
          reconciliation_article_ids: claimOutcome.retryIds,
          measurement_quality: "response_observed_business_write_incomplete",
        },
      });
      console.warn(
        `[analyze-articles] ${failedWriteArticleIds.size} article(s) parked for manual reconciliation after a failed write.`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          partial: true,
          retryable: false,
          reconciliation_required: true,
          error: "business_persistence_incomplete",
          run_id: runId,
          articles_processed: claimOutcome.completeIds.length,
          articles_reconciliation_required: claimOutcome.retryIds.length,
          signals_created: signalsCreated,
          signals_filtered_by_revenue: signalsFilteredByRevenue,
          auto_enriched: autoEnrichedCount,
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    await finalizeLovableAttempt(true, null);

    console.log(
      `Analysis complete: ${signalsCreated} signals created, ${signalsFilteredByRevenue} filtered by revenue, ${autoEnrichedCount} auto-enriched`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        run_id: runId,
        partial: false,
        articles_processed: claimOutcome.completeIds.length,
        articles_retryable: 0,
        signals_created: signalsCreated,
        signals_filtered_by_revenue: signalsFilteredByRevenue,
        auto_enriched: autoEnrichedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in analyze-articles:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    if (failActiveClaim) {
      try {
        await failActiveClaim(errorMessage);
      } catch (claimError) {
        console.error(
          "[analyze-articles] Failed to release active claim:",
          claimError,
        );
      }
    }
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

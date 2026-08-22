import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  boundNewsApiRequestBudget,
  canonicalizeArticleUrl,
  computeNextCheckpoint,
  fetchNewsApiWithRetry,
  inspectNewsApiAttemptHistory,
  measureNewsApiContent,
  NEWSAPI_ABSOLUTE_RESULT_CEILING,
  parseDomainsAllowlist,
  NEWSAPI_PAGE_SIZE,
  newsApiAttemptRequestKey,
  newsApiBusinessRequestKey,
  NewsApiLedgerError,
  NewsApiQuotaError,
  NewsApiRetryError,
  planFairFetchTasks,
  type PressQueryCursor,
  resolveNewsApiCursor,
} from "../_shared/press-news.ts";

const NEWS_FETCH_TIMEOUT_MS = 20_000;
const NEWS_MAX_ATTEMPTS = 3;
const NEWS_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_RUN_REQUEST_BUDGET = 20;
const MAX_RUN_REQUEST_BUDGET = 100;
const PAUSE_BETWEEN_PAGES_MS = 250;

type SearchQuery = {
  id: string;
  name: string;
  query: string;
  last_fetched_at: string | null;
};

type QueryWork = {
  query: SearchQuery;
  cursor: PressQueryCursor;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NEWS_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function asPositiveInteger(
  value: unknown,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function safeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function runIdFrom(value: unknown): string {
  return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value)
    ? value
    : crypto.randomUUID();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, {
    responseHeaders: corsHeaders,
  });
  if (!access.ok) return access.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const newsapiKey = Deno.env.get("NEWSAPI_KEY");
    if (!newsapiKey) {
      throw new Error("NEWSAPI key not configured in environment.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const requestBody = req.method === "POST"
      ? await req.json().catch(() => ({})) as Record<string, unknown>
      : {};
    const runId = runIdFrom(requestBody.run_id);
    const providerInvocationId = crypto.randomUUID();

    // Fail closed avant le premier appel payant si le ledger n'est pas lisible.
    const { error: ledgerReadyError } = await supabase
      .from("provider_usage_events")
      .select("id")
      .limit(1);
    if (ledgerReadyError) {
      throw new Error(
        `Provider ledger unavailable: ${ledgerReadyError.message}`,
      );
    }

    const { data: daysSetting, error: daysSettingError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "days_to_fetch")
      .maybeSingle();
    if (daysSettingError) throw daysSettingError;

    const { data: runBudgetSetting, error: runBudgetSettingError } =
      await supabase
        .from("settings")
        .select("value")
        .eq("key", "newsapi_requests_per_run")
        .maybeSingle();
    if (runBudgetSettingError) throw runBudgetSettingError;

    const { data: planSetting, error: planSettingError } = await supabase
      .from("newsapi_plan_settings")
      .select("daily_requests, max_results_per_query")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planSettingError) throw planSettingError;

    // Plafond de résultats du plan souscrit : au-delà, NewsAPI répond 426 et la
    // page n'existera jamais. Absent ou aberrant, on retombe sur la limite
    // absolue — une page de trop vaut mieux qu'une pagination désarmée.
    const configuredMaxResults = Number(planSetting?.max_results_per_query);
    const planMaxResults =
      Number.isFinite(configuredMaxResults) && configuredMaxResults > 0
        ? Math.floor(configuredMaxResults)
        : NEWSAPI_ABSOLUTE_RESULT_CEILING;

    // L'allowlist de sources (levier AMONT) : vide ou absente = aucun filtre.
    const { data: allowlistSetting, error: allowlistError } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "newsapi_source_allowlist")
      .maybeSingle();
    if (allowlistError) throw allowlistError;
    const sourceAllowlist = parseDomainsAllowlist(
      typeof allowlistSetting?.value === "string"
        ? allowlistSetting.value
        : JSON.stringify(allowlistSetting?.value ?? ""),
    );
    if (sourceAllowlist) {
      console.log(`[fetch-news] Allowlist de sources active (${sourceAllowlist.split(",").length} domaines)`);
    }

    const today = new Date().toISOString().slice(0, 10);
    const configuredDailyLimit = Number(planSetting?.daily_requests);
    if (
      !planSetting || !Number.isFinite(configuredDailyLimit) ||
      configuredDailyLimit <= 0
    ) {
      throw new Error("Plan NewsAPI absent ou non configuré (quota à 0).");
    }
    const dailyLimit = Math.floor(configuredDailyLimit);
    const { data: quotaSnapshot, error: quotaSnapshotError } = await supabase
      .rpc(
        "newsapi_quota_status",
        { p_daily_limit: dailyLimit, p_at: new Date().toISOString() },
      );
    if (quotaSnapshotError) {
      throw new Error(
        `Compteur NewsAPI illisible: ${quotaSnapshotError.message}`,
      );
    }
    const requestsAlreadyUsed = Number(quotaSnapshot?.used || 0);
    const dailyRemaining = Number(quotaSnapshot?.remaining || 0);
    const requestBudget = boundNewsApiRequestBudget({
      configured: runBudgetSetting?.value,
      requested: requestBody.max_requests,
      dailyRemaining,
      defaultBudget: DEFAULT_RUN_REQUEST_BUDGET,
      maximumBudget: MAX_RUN_REQUEST_BUDGET,
    });

    if (requestBudget === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          partial: true,
          budget_exhausted: true,
          error: "Quota NewsAPI épuisé : aucune acquisition Presse exécutée",
          run_id: runId,
          api_requests: 0,
          daily_limit: dailyLimit,
          daily_requests_used: requestsAlreadyUsed,
          daily_requests_remaining: dailyRemaining,
          new_articles_saved: 0,
          content_available: 0,
          content_length: 0,
          content_truncated: 0,
          content_source: "newsapi_excerpt_only",
          full_article_scraping: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const daysToFetch = asPositiveInteger(daysSetting?.value, 1, 30);
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - daysToFetch);
    const defaultWindow = {
      windowFrom: fromDate.toISOString().slice(0, 10),
      windowTo: new Date().toISOString(),
    };

    const { data: queryRows, error: queriesError } = await supabase
      .from("search_queries")
      .select("id,name,query,last_fetched_at")
      .eq("is_active", true)
      .order("last_fetched_at", { ascending: true, nullsFirst: true });
    if (queriesError) throw queriesError;

    const queries = (queryRows ?? []) as SearchQuery[];
    const cursors = new Map<string, PressQueryCursor>();
    for (const query of queries) {
      const { data: usage, error: cursorError } = await supabase
        .from("newsapi_usage")
        .select("details")
        .eq("query_id", query.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cursorError) throw cursorError;
      cursors.set(
        query.id,
        resolveNewsApiCursor(usage?.details, defaultWindow),
      );
    }

    const queriesById = new Map(queries.map((query) => [query.id, query]));
    const queue: QueryWork[] = planFairFetchTasks(
      queries.map((query) => ({
        id: query.id,
        lastFetchedAt: query.last_fetched_at,
      })),
      cursors,
      queries.length,
      defaultWindow,
    ).map((task) => ({
      query: queriesById.get(task.queryId)!,
      cursor: {
        nextPage: task.page,
        windowFrom: task.windowFrom,
        windowTo: task.windowTo,
      },
    }));

    let totalArticles = 0;
    let newArticles = 0;
    let totalRequests = 0;
    let failedPages = 0;
    let totalContentLength = 0;
    let contentAvailable = 0;
    let contentTruncated = 0;
    const completedQueries = new Set<string>();
    const attemptedQueries = new Set<string>();
    const reserveProviderAttempt = async (event: {
      query: SearchQuery;
      requestKey: string;
      businessKey: string;
      attempt: number;
      page: number;
      windowFrom: string;
      windowTo: string;
      occurredAt: string;
    }) => {
      const { data, error } = await supabase.rpc("reserve_newsapi_request", {
        p_request_key: event.requestKey,
        p_run_id: runId,
        p_query_id: event.query.id,
        p_daily_limit: dailyLimit,
        p_occurred_at: event.occurredAt,
        p_metadata: {
          unit_name: "request",
          invocation_id: providerInvocationId,
          business_key: event.businessKey,
          attempt: event.attempt,
          page: event.page,
          page_size: NEWSAPI_PAGE_SIZE,
          window_from: event.windowFrom,
          window_to: event.windowTo,
        },
      });
      if (error) {
        throw new NewsApiLedgerError(
          `Provider ledger write failed: ${error.message}`,
          event.attempt,
          { cause: error },
        );
      }
      if (!data?.allowed) {
        if (data?.reason === "daily_quota_exhausted") {
          throw new NewsApiQuotaError(Math.max(0, event.attempt - 1));
        }
        throw new NewsApiLedgerError(
          `Provider reservation rejected: ${data?.reason || "unknown"}`,
          event.attempt,
        );
      }
    };

    const updateProviderAttempt = async (
      requestKey: string,
      patch: {
        items_count?: number;
        success?: boolean;
        error_code?: string | null;
        http_status?: number | null;
      },
      attempts: number,
    ) => {
      if (typeof patch.success !== "boolean") {
        throw new NewsApiLedgerError(
          "Provider completion requires a success outcome",
          attempts,
        );
      }
      const { data, error } = await supabase.rpc("complete_newsapi_request", {
        p_request_key: requestKey,
        p_items_count: patch.items_count ?? 0,
        p_success: patch.success,
        p_error_code: patch.error_code ?? null,
        p_http_status: patch.http_status ?? null,
        p_metadata: {},
      });
      if (error || !data) {
        throw new NewsApiLedgerError(
          `Provider ledger update failed: ${
            error?.message || "completion returned no event"
          }`,
          attempts,
          { cause: error },
        );
      }
    };

    const recordUsage = async (
      query: SearchQuery,
      requestsCount: number,
      articlesFetched: number,
      details: Record<string, unknown>,
    ) => {
      const { error } = await supabase.from("newsapi_usage").insert({
        date: today,
        requests_count: requestsCount,
        articles_fetched: articlesFetched,
        query_id: query.id,
        details: { query_name: query.name, ...details },
      });
      if (error) {
        throw new Error(
          `Impossible de journaliser l'usage NewsAPI: ${error.message}`,
        );
      }
    };

    while (queue.length > 0 && totalRequests < requestBudget) {
      const work = queue.shift()!;
      const { query, cursor } = work;
      attemptedQueries.add(query.id);

      const newsUrl = new URL("https://newsapi.org/v2/everything");
      newsUrl.searchParams.set("q", query.query);
      newsUrl.searchParams.set("language", "fr");
      newsUrl.searchParams.set("sortBy", "publishedAt");
      newsUrl.searchParams.set("from", cursor.windowFrom);
      newsUrl.searchParams.set("to", cursor.windowTo);
      newsUrl.searchParams.set("pageSize", String(NEWSAPI_PAGE_SIZE));
      newsUrl.searchParams.set("page", String(cursor.nextPage));
      if (sourceAllowlist) {
        // Le filtre AMONT : NewsAPI ne rend que ces domaines. Mesuré le
        // 22/08 : ~97 % des articles ramenés sans filtre étaient hors cible.
        newsUrl.searchParams.set("domains", sourceAllowlist);
      }
      newsUrl.searchParams.set("apiKey", newsapiKey);

      const businessKey = newsApiBusinessRequestKey({
        queryId: query.id,
        windowFrom: cursor.windowFrom,
        windowTo: cursor.windowTo,
        page: cursor.nextPage,
      });
      const { data: ambiguousReservation, error: ambiguousReservationError } =
        await supabase
          .from("provider_quota_reservations")
          .select("request_key")
          .eq("provider", "newsapi")
          .eq("query_id", query.id)
          .eq("status", "reserved")
          .limit(1)
          .maybeSingle();
      if (ambiguousReservationError) {
        throw new NewsApiLedgerError(
          `NewsAPI reservation history unavailable: ${ambiguousReservationError.message}`,
          0,
          { cause: ambiguousReservationError },
        );
      }
      if (ambiguousReservation) {
        throw new NewsApiLedgerError(
          `NewsAPI dispatch unconfirmed for query ${query.id}; manual reconciliation required`,
          0,
        );
      }

      const { data: attemptRows, error: attemptRowsError } = await supabase
        .from("provider_quota_reservations")
        .select("status,metadata")
        .eq("provider", "newsapi")
        .eq("query_id", query.id)
        .contains("metadata", { business_key: businessKey })
        .order("occurred_at", { ascending: true })
        .limit(NEWS_MAX_ATTEMPTS + 1);
      if (attemptRowsError) {
        throw new NewsApiLedgerError(
          `NewsAPI attempt history unavailable: ${attemptRowsError.message}`,
          0,
          { cause: attemptRowsError },
        );
      }
      const history = inspectNewsApiAttemptHistory(
        (attemptRows ?? []).map((row) => ({
          status: row.status,
          attempt: Number(
            row.metadata && typeof row.metadata === "object" &&
              !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>).attempt
              : 0,
          ),
        })),
        NEWS_MAX_ATTEMPTS,
      );
      if (history.blockingReason) {
        throw new NewsApiLedgerError(
          `NewsAPI logical request blocked: ${history.blockingReason}`,
          0,
        );
      }

      const attemptsAvailable = Math.min(
        NEWS_MAX_ATTEMPTS - history.nextAttempt + 1,
        requestBudget - totalRequests,
      );
      let attempts = 0;
      let response: Response;
      let lastAttemptRequestKey = "";
      let pageAttempt = history.nextAttempt - 1;
      try {
        const result = await fetchNewsApiWithRetry(
          newsUrl.toString(),
          async (url) => {
            pageAttempt += 1;
            const requestKey = newsApiAttemptRequestKey(
              businessKey,
              pageAttempt,
            );
            const occurredAt = new Date().toISOString();
            lastAttemptRequestKey = requestKey;
            await reserveProviderAttempt({
              query,
              requestKey,
              businessKey,
              attempt: pageAttempt,
              page: cursor.nextPage,
              windowFrom: cursor.windowFrom,
              windowTo: cursor.windowTo,
              occurredAt,
            });
            try {
              const providerResponse = await fetchWithTimeout(url);
              if (!providerResponse.ok) {
                await updateProviderAttempt(
                  requestKey,
                  {
                    success: false,
                    error_code: `http_${providerResponse.status}`,
                    http_status: providerResponse.status,
                  },
                  pageAttempt,
                );
              }
              return providerResponse;
            } catch (error) {
              if (
                error instanceof NewsApiLedgerError ||
                error instanceof NewsApiQuotaError
              ) throw error;
              throw new NewsApiLedgerError(
                `NewsAPI dispatch unconfirmed for ${businessKey}; manual reconciliation required`,
                pageAttempt,
                { cause: error },
              );
            }
          },
          sleep,
          {
            maxAttempts: attemptsAvailable,
            baseDelayMs: NEWS_RETRY_BASE_DELAY_MS,
          },
        );
        attempts = result.attempts;
        response = result.response;
      } catch (error) {
        if (error instanceof NewsApiLedgerError) throw error;
        if (error instanceof NewsApiQuotaError) {
          // Une autre invocation a consommé le dernier slot entre notre
          // préflight et cette page. Aucun appel HTTP n'est parti.
          totalRequests += error.attempts;
          break;
        }
        attempts = error instanceof NewsApiRetryError
          ? error.attempts
          : attemptsAvailable;
        totalRequests += attempts;
        failedPages += 1;
        await recordUsage(query, attempts, 0, {
          status: "request_error",
          page: cursor.nextPage,
          next_page: cursor.nextPage,
          window_from: cursor.windowFrom,
          window_to: cursor.windowTo,
          error: error instanceof Error
            ? error.message
            : "Unknown network error",
        });
        continue;
      }

      totalRequests += attempts;
      if (!response.ok) {
        const errorText = await response.text();
        // HTTP 426 (Upgrade Required) n'est pas une panne : c'est NewsAPI qui
        // dit « cette page dépasse ce que votre abonnement expose ». Réessayer
        // ne la fera jamais apparaître.
        //
        // Le traiter comme une erreur ordinaire — en réécrivant `next_page` sur
        // la page qui vient d'échouer — fige le curseur pour toujours : chaque
        // scan suivant redemande la même page condamnée, échoue, et marque un
        // scan par ailleurs sain en `failed`. Une requête de veille sur 28 est
        // restée muette 16 heures pour cette raison le 2026-08-22.
        //
        // On la traite donc pour ce qu'elle est : une FIN DE PAGINATION. Le
        // curseur repart en page 1, et la page refusée ne compte pas comme une
        // page en échec — sinon le scan resterait rouge en ayant tout collecté.
        if (response.status === 426) {
          await recordUsage(query, attempts, 0, {
            status: "plan_page_limit",
            http_status: response.status,
            page: cursor.nextPage,
            next_page: 1,
            window_from: cursor.windowFrom,
            window_to: cursor.windowTo,
            plan_max_results: planMaxResults,
            error: errorText.slice(0, 1_000),
          });
          continue;
        }
        failedPages += 1;
        await recordUsage(query, attempts, 0, {
          status: "http_error",
          http_status: response.status,
          page: cursor.nextPage,
          next_page: cursor.nextPage,
          window_from: cursor.windowFrom,
          window_to: cursor.windowTo,
          error: errorText.slice(0, 1_000),
        });
        continue;
      }

      let data: Record<string, unknown>;
      try {
        data = await response.json();
      } catch {
        await updateProviderAttempt(
          lastAttemptRequestKey,
          { success: false, error_code: "invalid_json" },
          attempts,
        );
        failedPages += 1;
        await recordUsage(query, attempts, 0, {
          status: "invalid_json",
          page: cursor.nextPage,
          next_page: cursor.nextPage,
          window_from: cursor.windowFrom,
          window_to: cursor.windowTo,
        });
        continue;
      }

      if (data.status !== "ok" || !Array.isArray(data.articles)) {
        await updateProviderAttempt(
          lastAttemptRequestKey,
          { success: false, error_code: "api_error" },
          attempts,
        );
        failedPages += 1;
        await recordUsage(query, attempts, 0, {
          status: "api_error",
          page: cursor.nextPage,
          next_page: cursor.nextPage,
          window_from: cursor.windowFrom,
          window_to: cursor.windowTo,
          error: typeof data.message === "string"
            ? data.message.slice(0, 1_000)
            : "Invalid NewsAPI payload",
        });
        continue;
      }

      const articles = data.articles as Array<Record<string, unknown>>;
      totalArticles += articles.length;
      const pageContentMetrics = articles.reduce<{
        contentLength: number;
        available: number;
        truncated: number;
      }>(
        (metrics, article) => {
          const content = measureNewsApiContent(article.content);
          metrics.contentLength += content.contentLength;
          if (content.contentLength > 0) metrics.available += 1;
          if (content.contentTruncated) metrics.truncated += 1;
          return metrics;
        },
        { contentLength: 0, available: 0, truncated: 0 },
      );
      totalContentLength += pageContentMetrics.contentLength;
      contentAvailable += pageContentMetrics.available;
      contentTruncated += pageContentMetrics.truncated;

      const rowsByUrl = new Map<string, Record<string, unknown>>();
      for (const article of articles) {
        const canonicalUrl = canonicalizeArticleUrl(article.url);
        if (!canonicalUrl || rowsByUrl.has(canonicalUrl)) continue;
        const source = article.source && typeof article.source === "object"
          ? article.source as Record<string, unknown>
          : null;
        rowsByUrl.set(canonicalUrl, {
          query_id: query.id,
          title: typeof article.title === "string" && article.title.trim()
            ? article.title
            : "Sans titre",
          description: typeof article.description === "string"
            ? article.description
            : null,
          content: typeof article.content === "string" ? article.content : null,
          url: canonicalUrl,
          source_name: typeof source?.name === "string" ? source.name : null,
          author: typeof article.author === "string" ? article.author : null,
          image_url: typeof article.urlToImage === "string"
            ? article.urlToImage
            : null,
          published_at: safeIsoDate(article.publishedAt),
        });
      }

      let insertedCount = 0;
      if (rowsByUrl.size > 0) {
        const { data: insertedRows, error: insertError } = await supabase
          .from("raw_articles")
          .upsert([...rowsByUrl.values()], {
            onConflict: "url",
            ignoreDuplicates: true,
          })
          .select("id");
        if (insertError) {
          failedPages += 1;
          await recordUsage(query, attempts, 0, {
            status: "persistence_error",
            page: cursor.nextPage,
            next_page: cursor.nextPage,
            window_from: cursor.windowFrom,
            window_to: cursor.windowTo,
            content_available: pageContentMetrics.available,
            content_length: pageContentMetrics.contentLength,
            content_truncated: pageContentMetrics.truncated,
            content_source: "newsapi_excerpt_only",
            full_article_scraping: false,
            error: insertError.message.slice(0, 1_000),
          });
          throw new NewsApiLedgerError(
            `NewsAPI response received but article persistence failed for ${businessKey}`,
            pageAttempt,
            { cause: insertError },
          );
        }
        insertedCount = insertedRows?.length ?? 0;
      }

      const totalResults = typeof data.totalResults === "number"
        ? data.totalResults
        : articles.length;
      const nextPage = computeNextCheckpoint({
        page: cursor.nextPage,
        pageSize: NEWSAPI_PAGE_SIZE,
        received: articles.length,
        totalResults,
        maxResults: planMaxResults,
      });
      const checkpointedAt = new Date().toISOString();
      const { error: queryUpdateError } = await supabase
        .from("search_queries")
        .update({ last_fetched_at: checkpointedAt })
        .eq("id", query.id);
      if (queryUpdateError) {
        failedPages += 1;
        await recordUsage(query, attempts, insertedCount, {
          status: "persistence_error",
          page: cursor.nextPage,
          next_page: cursor.nextPage,
          window_from: cursor.windowFrom,
          window_to: cursor.windowTo,
          content_available: pageContentMetrics.available,
          content_length: pageContentMetrics.contentLength,
          content_truncated: pageContentMetrics.truncated,
          content_source: "newsapi_excerpt_only",
          full_article_scraping: false,
          error: queryUpdateError.message.slice(0, 1_000),
        });
        throw new NewsApiLedgerError(
          `NewsAPI response received but checkpoint persistence failed for ${businessKey}`,
          pageAttempt,
          { cause: queryUpdateError },
        );
      }

      await recordUsage(query, attempts, insertedCount, {
        status: "success",
        page: cursor.nextPage,
        next_page: nextPage,
        window_from: cursor.windowFrom,
        window_to: cursor.windowTo,
        total_results: totalResults,
        articles_received: articles.length,
        canonical_articles: rowsByUrl.size,
        content_available: pageContentMetrics.available,
        content_length: pageContentMetrics.contentLength,
        content_length_average: pageContentMetrics.available > 0
          ? Math.round(
            pageContentMetrics.contentLength / pageContentMetrics.available,
          )
          : 0,
        content_truncated: pageContentMetrics.truncated,
        content_source: "newsapi_excerpt_only",
        full_article_scraping: false,
        checkpointed_at: checkpointedAt,
      });
      await updateProviderAttempt(
        lastAttemptRequestKey,
        {
          items_count: articles.length,
          success: true,
          error_code: null,
          http_status: response.status,
        },
        pageAttempt,
      );

      newArticles += insertedCount;
      if (nextPage === 1) {
        completedQueries.add(query.id);
      } else {
        queue.push({
          query: { ...query, last_fetched_at: checkpointedAt },
          cursor: { ...cursor, nextPage },
        });
      }

      if (queue.length > 0 && totalRequests < requestBudget) {
        await sleep(PAUSE_BETWEEN_PAGES_MS);
      }
    }

    return new Response(
      JSON.stringify({
        success: failedPages === 0,
        partial: failedPages > 0,
        request_budget: requestBudget,
        run_id: runId,
        api_requests: totalRequests,
        daily_limit: dailyLimit,
        daily_requests_used: requestsAlreadyUsed + totalRequests,
        daily_requests_remaining: Math.max(0, dailyRemaining - totalRequests),
        queries_available: queries.length,
        queries_attempted: attemptedQueries.size,
        queries_completed: completedQueries.size,
        pages_failed: failedPages,
        total_articles_found: totalArticles,
        new_articles_saved: newArticles,
        content_available: contentAvailable,
        content_length: totalContentLength,
        content_length_average: contentAvailable > 0
          ? Math.round(totalContentLength / contentAvailable)
          : 0,
        content_truncated: contentTruncated,
        content_source: "newsapi_excerpt_only",
        full_article_scraping: false,
      }),
      {
        status: failedPages > 0 ? 207 : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error in fetch-news:", error);
    const errorMessage = error instanceof Error
      ? error.message
      : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

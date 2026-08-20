export const NEWSAPI_PAGE_SIZE = 100;

function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  const parsed = typeof value === "number"
    ? value
    : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

/**
 * Le parametre d'une invocation peut reduire le budget configure, jamais
 * l'augmenter. Le solde journalier reste la borne finale.
 */
export function boundNewsApiRequestBudget(input: {
  configured: unknown;
  requested?: unknown;
  dailyRemaining: number;
  defaultBudget: number;
  maximumBudget: number;
}): number {
  const configured = positiveInteger(
    input.configured,
    input.defaultBudget,
    input.maximumBudget,
  );
  const requested = input.requested === undefined
    ? configured
    : positiveInteger(input.requested, configured, configured);
  return Math.max(0, Math.min(requested, Math.floor(input.dailyRemaining)));
}

export function interpretPressFetchResult(raw: unknown): {
  canAnalyzeExistingArticles: boolean;
  terminalError: string | null;
} {
  const result = raw && typeof raw === "object"
    ? raw as Record<string, unknown>
    : {};

  if (result.budget_exhausted === true) {
    return {
      canAnalyzeExistingArticles: true,
      terminalError:
        "Quota NewsAPI épuisé : aucune acquisition Presse exécutée",
    };
  }

  if (result.partial === true) {
    return {
      canAnalyzeExistingArticles: true,
      terminalError: `Fetch partiel: ${
        Number(result.pages_failed ?? 0)
      } page(s) en échec`,
    };
  }

  if (result.success === true) {
    return { canAnalyzeExistingArticles: true, terminalError: null };
  }

  return {
    canAnalyzeExistingArticles: false,
    terminalError: typeof result.error === "string" && result.error.trim()
      ? result.error
      : "Unknown error",
  };
}

export function measureNewsApiContent(raw: unknown): {
  contentLength: number;
  contentTruncated: boolean;
} {
  if (typeof raw !== "string") {
    return { contentLength: 0, contentTruncated: false };
  }
  return {
    contentLength: raw.length,
    // NewsAPI ajoute ce marqueur lorsque `content` n'est qu'un extrait.
    contentTruncated: /\[\+\d+\s+chars\]\s*$/i.test(raw),
  };
}

const TRACKING_QUERY_PARAMS = new Set([
  "_hsenc",
  "_hsmi",
  "dclid",
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "yclid",
]);

export function canonicalizeArticleUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        TRACKING_QUERY_PARAMS.has(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();

    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export type PressQueryCursor = {
  nextPage: number;
  windowFrom: string;
  windowTo: string;
};

export type PressQueryForPlanning = {
  id: string;
  lastFetchedAt: string | null;
};

export type PressFetchTask = {
  queryId: string;
  page: number;
  windowFrom: string;
  windowTo: string;
};

export function resolveNewsApiCursor(
  details: unknown,
  defaultWindow: { windowFrom: string; windowTo: string },
): PressQueryCursor {
  if (!details || typeof details !== "object") {
    return { nextPage: 1, ...defaultWindow };
  }

  const value = details as Record<string, unknown>;
  const parsedPage = Number.parseInt(String(value.next_page ?? ""), 10);
  const nextPage = Number.isFinite(parsedPage) && parsedPage > 0
    ? Math.floor(parsedPage)
    : 1;
  const previousFailed = value.status !== "success";
  if (nextPage === 1 && !previousFailed) {
    return { nextPage: 1, ...defaultWindow };
  }

  return {
    nextPage,
    windowFrom: typeof value.window_from === "string" && value.window_from
      ? value.window_from
      : defaultWindow.windowFrom,
    windowTo: typeof value.window_to === "string" && value.window_to
      ? value.window_to
      : defaultWindow.windowTo,
  };
}

/**
 * Produit un ordre round-robin déterministe. L'exécuteur ne doit valider le
 * prochain slot d'une requête qu'après la persistance réussie du slot courant.
 */
export function planFairFetchTasks(
  queries: PressQueryForPlanning[],
  cursors: Map<string, PressQueryCursor>,
  budget: number,
  defaultWindow: { windowFrom: string; windowTo: string },
): PressFetchTask[] {
  if (budget <= 0 || queries.length === 0) return [];

  const ordered = [...queries].sort((left, right) => {
    if (left.lastFetchedAt === right.lastFetchedAt) {
      return left.id.localeCompare(right.id);
    }
    if (left.lastFetchedAt === null) return -1;
    if (right.lastFetchedAt === null) return 1;
    return left.lastFetchedAt.localeCompare(right.lastFetchedAt);
  });

  const tasks: PressFetchTask[] = [];
  const pagesSeen = new Map<string, number>();
  for (let index = 0; index < budget; index += 1) {
    const query = ordered[index % ordered.length];
    const cursor = cursors.get(query.id);
    const offset = pagesSeen.get(query.id) ?? 0;
    const initialPage = Math.max(1, Math.floor(cursor?.nextPage ?? 1));
    tasks.push({
      queryId: query.id,
      page: initialPage + offset,
      windowFrom: cursor?.windowFrom ?? defaultWindow.windowFrom,
      windowTo: cursor?.windowTo ?? defaultWindow.windowTo,
    });
    pagesSeen.set(query.id, offset + 1);
  }

  return tasks;
}

export function computeNextCheckpoint(input: {
  page: number;
  pageSize: number;
  received: number;
  totalResults: number;
}): number {
  const { page, pageSize, received, totalResults } = input;
  const reachedReportedEnd = Number.isFinite(totalResults) &&
    page * pageSize >= totalResults;
  // NewsAPI Everything n'expose au maximum que les 10 000 premiers résultats.
  const reachedNewsApiEnd = page * pageSize >= 10_000;
  if (received < pageSize || reachedReportedEnd || reachedNewsApiEnd) return 1;
  return page + 1;
}

export function newsApiBusinessRequestKey(input: {
  queryId: string;
  windowFrom: string;
  windowTo: string;
  page: number;
}): string {
  const page = Math.floor(input.page);
  if (
    input.queryId.trim() === "" || input.windowFrom.trim() === "" ||
    input.windowTo.trim() === "" || !Number.isFinite(page) || page < 1
  ) {
    throw new TypeError("Invalid NewsAPI business request identity");
  }

  return [
    "newsapi",
    "everything",
    encodeURIComponent(input.queryId.trim()),
    encodeURIComponent(input.windowFrom.trim()),
    encodeURIComponent(input.windowTo.trim()),
    `page-${page}`,
  ].join(":");
}

export function newsApiAttemptRequestKey(
  businessKey: string,
  attempt: number,
): string {
  const normalizedAttempt = Math.floor(attempt);
  if (businessKey.trim() === "" || normalizedAttempt < 1) {
    throw new TypeError("Invalid NewsAPI attempt identity");
  }
  return `${businessKey}:attempt-${normalizedAttempt}`;
}

export function inspectNewsApiAttemptHistory(
  rows: Array<{ status: string; attempt: number }>,
  maxAttempts: number,
): { nextAttempt: number; blockingReason: string | null } {
  const normalizedMaximum = Math.max(1, Math.floor(maxAttempts));
  if (rows.some((row) => row.status === "reserved")) {
    return { nextAttempt: 0, blockingReason: "dispatch_unconfirmed" };
  }
  if (rows.some((row) => row.status === "completed")) {
    return { nextAttempt: 0, blockingReason: "already_completed" };
  }

  const observedAttempts = rows
    .map((row) => Math.floor(row.attempt))
    .filter((attempt) => Number.isFinite(attempt) && attempt > 0);
  const nextAttempt =
    (observedAttempts.length > 0 ? Math.max(...observedAttempts) : 0) + 1;
  if (nextAttempt > normalizedMaximum) {
    return { nextAttempt: 0, blockingReason: "attempts_exhausted" };
  }
  return { nextAttempt, blockingReason: null };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

export class NewsApiRetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "NewsApiRetryError";
  }
}

export class NewsApiLedgerError extends NewsApiRetryError {
  constructor(
    message: string,
    attempts: number,
    options?: { cause?: unknown },
  ) {
    super(message, attempts, options);
    this.name = "NewsApiLedgerError";
  }
}

export class NewsApiQuotaError extends NewsApiRetryError {
  constructor(attempts = 0, message = "NewsAPI daily quota exhausted") {
    super(message, attempts);
    this.name = "NewsApiQuotaError";
  }
}

export async function fetchNewsApiWithRetry(
  url: string,
  fetchImpl: FetchLike,
  sleep: SleepLike,
  options: { maxAttempts: number; baseDelayMs: number },
): Promise<{ response: Response; attempts: number }> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  let lastNetworkError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImpl(url);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        return { response, attempts: attempt };
      }

      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1_000, 10_000)
          : options.baseDelayMs * 2 ** (attempt - 1);
      await response.body?.cancel().catch(() => undefined);
      await sleep(delayMs);
    } catch (error) {
      if (
        error instanceof NewsApiLedgerError ||
        error instanceof NewsApiQuotaError
      ) throw error;
      lastNetworkError = error;
      if (attempt === maxAttempts) {
        throw new NewsApiRetryError("NewsAPI network request failed", attempt, {
          cause: error,
        });
      }
      await sleep(options.baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new NewsApiRetryError(
    "NewsAPI request failed without a response",
    maxAttempts,
    {
      cause: lastNetworkError,
    },
  );
}

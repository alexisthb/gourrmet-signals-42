import {
  boundNewsApiRequestBudget,
  canonicalizeArticleUrl,
  computeNextCheckpoint,
  fetchNewsApiWithRetry,
  inspectNewsApiAttemptHistory,
  interpretPressFetchResult,
  measureNewsApiContent,
  newsApiAttemptRequestKey,
  newsApiBusinessRequestKey,
  NewsApiLedgerError,
  planFairFetchTasks,
  resolveNewsApiCursor,
} from "./press-news.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(message ?? `Expected ${right}, received ${left}`);
  }
}

Deno.test("canonicalizeArticleUrl retire le tracking sans casser les parametres metier", () => {
  assertEquals(
    canonicalizeArticleUrl(
      "HTTPS://Example.COM:443/actualite/?utm_source=x&article=42&fbclid=y#section",
    ),
    "https://example.com/actualite?article=42",
  );
  assertEquals(
    canonicalizeArticleUrl("https://example.com/"),
    "https://example.com/",
  );
  assertEquals(canonicalizeArticleUrl("javascript:alert(1)"), null);
});

Deno.test("planFairFetchTasks tourne entre les requetes et reprend leur page", () => {
  const tasks = planFairFetchTasks(
    [
      { id: "recent", lastFetchedAt: "2026-08-20T10:00:00.000Z" },
      { id: "never", lastFetchedAt: null },
      { id: "old", lastFetchedAt: "2026-08-19T10:00:00.000Z" },
    ],
    new Map([
      ["never", {
        nextPage: 3,
        windowFrom: "2026-08-18",
        windowTo: "2026-08-20T09:00:00.000Z",
      }],
      ["old", {
        nextPage: 2,
        windowFrom: "2026-08-18",
        windowTo: "2026-08-20T09:00:00.000Z",
      }],
    ]),
    5,
    { windowFrom: "2026-08-19", windowTo: "2026-08-20T12:00:00.000Z" },
  );

  assertEquals(tasks.map((task) => `${task.queryId}:${task.page}`), [
    "never:3",
    "old:2",
    "recent:1",
    "never:4",
    "old:3",
  ]);
});

Deno.test("une page NewsAPI en echec conserve sa fenetre meme a la page 1", () => {
  const currentWindow = {
    windowFrom: "2026-08-19",
    windowTo: "2026-08-20T15:00:00.000Z",
  };
  const failedWindow = {
    window_from: "2026-08-18",
    window_to: "2026-08-20T12:00:00.000Z",
    next_page: 1,
    status: "http_error",
  };
  assertEquals(resolveNewsApiCursor(failedWindow, currentWindow), {
    nextPage: 1,
    windowFrom: failedWindow.window_from,
    windowTo: failedWindow.window_to,
  });
  assertEquals(
    resolveNewsApiCursor({ ...failedWindow, status: "success" }, currentWindow),
    { nextPage: 1, ...currentWindow },
  );
});

Deno.test("le budget demande ne peut jamais elargir le plafond configure", () => {
  assertEquals(
    boundNewsApiRequestBudget({
      configured: 20,
      requested: 80,
      dailyRemaining: 100,
      defaultBudget: 20,
      maximumBudget: 100,
    }),
    20,
  );
  assertEquals(
    boundNewsApiRequestBudget({
      configured: 20,
      requested: 5,
      dailyRemaining: 3,
      defaultBudget: 20,
      maximumBudget: 100,
    }),
    3,
  );
});

Deno.test("computeNextCheckpoint avance seulement tant que la fenetre a une autre page", () => {
  assertEquals(
    computeNextCheckpoint({
      page: 2,
      pageSize: 100,
      received: 100,
      totalResults: 450,
    }),
    3,
  );
  assertEquals(
    computeNextCheckpoint({
      page: 5,
      pageSize: 100,
      received: 50,
      totalResults: 450,
    }),
    1,
  );
});

Deno.test("la cle NewsAPI est stable par requete logique et tentative", () => {
  const businessKey = newsApiBusinessRequestKey({
    queryId: "query-42",
    windowFrom: "2026-08-18",
    windowTo: "2026-08-20T12:00:00.000Z",
    page: 3,
  });
  assertEquals(
    businessKey,
    "newsapi:everything:query-42:2026-08-18:2026-08-20T12%3A00%3A00.000Z:page-3",
  );
  assertEquals(
    newsApiAttemptRequestKey(businessKey, 2),
    `${businessKey}:attempt-2`,
  );
});

Deno.test("une tentative NewsAPI ambigue bloque toute resoumission", () => {
  assertEquals(
    inspectNewsApiAttemptHistory(
      [{ status: "failed", attempt: 1 }, { status: "reserved", attempt: 2 }],
      3,
    ),
    { nextAttempt: 0, blockingReason: "dispatch_unconfirmed" },
  );
  assertEquals(
    inspectNewsApiAttemptHistory([{ status: "failed", attempt: 1 }], 3),
    { nextAttempt: 2, blockingReason: null },
  );
  assertEquals(
    inspectNewsApiAttemptHistory([
      { status: "failed", attempt: 1 },
      { status: "failed", attempt: 2 },
      { status: "failed", attempt: 3 },
    ], 3),
    { nextAttempt: 0, blockingReason: "attempts_exhausted" },
  );
});

Deno.test("fetchNewsApiWithRetry retente 429 et 5xx avec backoff", async () => {
  const statuses = [429, 503, 200];
  const delays: number[] = [];
  const result = await fetchNewsApiWithRetry(
    "https://newsapi.example.test",
    async () => {
      const status = statuses.shift() ?? 500;
      return new Response(
        status === 200
          ? JSON.stringify({ status: "ok", articles: [] })
          : "retry",
        { status },
      );
    },
    async (ms) => {
      delays.push(ms);
    },
    { maxAttempts: 3, baseDelayMs: 100 },
  );

  assertEquals(result.attempts, 3);
  assertEquals(result.response.status, 200);
  assertEquals(delays, [100, 200]);
});

Deno.test("fetchNewsApiWithRetry ne retente pas une erreur 400", async () => {
  let calls = 0;
  const result = await fetchNewsApiWithRetry(
    "https://newsapi.example.test",
    async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    },
    async () => {},
    { maxAttempts: 3, baseDelayMs: 100 },
  );

  assertEquals(calls, 1);
  assertEquals(result.response.status, 400);
});

Deno.test("measureNewsApiContent rend visible la troncature fournisseur", () => {
  assertEquals(measureNewsApiContent("Début de l'article… [+1840 chars]"), {
    contentLength: 33,
    contentTruncated: true,
  });
  assertEquals(measureNewsApiContent("Article complet"), {
    contentLength: 15,
    contentTruncated: false,
  });
  assertEquals(measureNewsApiContent(null), {
    contentLength: 0,
    contentTruncated: false,
  });
});

Deno.test("un quota NewsAPI epuise permet les reprises mais interdit le faux succes", () => {
  assertEquals(
    interpretPressFetchResult({
      success: false,
      partial: true,
      budget_exhausted: true,
    }),
    {
      canAnalyzeExistingArticles: true,
      terminalError:
        "Quota NewsAPI épuisé : aucune acquisition Presse exécutée",
    },
  );

  assertEquals(
    interpretPressFetchResult({ success: true, new_articles_saved: 4 }),
    { canAnalyzeExistingArticles: true, terminalError: null },
  );

  assertEquals(
    interpretPressFetchResult({ success: false, error: "provider down" }),
    { canAnalyzeExistingArticles: false, terminalError: "provider down" },
  );
});

Deno.test("un echec de ledger interdit toute nouvelle tentative payante", async () => {
  let calls = 0;
  let failedAsExpected = false;
  try {
    await fetchNewsApiWithRetry(
      "https://newsapi.example.test",
      async () => {
        calls += 1;
        throw new NewsApiLedgerError("ledger unavailable", calls);
      },
      async () => {},
      { maxAttempts: 3, baseDelayMs: 100 },
    );
  } catch (error) {
    failedAsExpected = error instanceof NewsApiLedgerError;
  }

  assertEquals(failedAsExpected, true);
  assertEquals(calls, 1);
});

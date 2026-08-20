import {
  callMeteredLovableAI,
  extractLovableAITokenUsage,
  finalizeLovableAIFromCachedResponse,
  type LovableAICachedFinalizationInput,
  lovableAICohortKey,
  lovableAIRequestKey,
} from "./lovable-ai-usage.ts";
import type { ProviderUsageInput } from "./provider-usage.ts";

type LedgerStubClient = LovableAICachedFinalizationInput["supabase"];

/**
 * Ledger minimal : capture la ligne écrite et impose le résultat de la
 * finalisation, pour distinguer « intention trouvée et confirmée » de
 * « plus aucune intention non confirmée » (cas d'une reprise).
 */
function ledgerStub(
  outcome: { data: unknown; error: { message: string } | null },
) {
  const updates: Record<string, unknown>[] = [];
  const client = {
    from(_table: string) {
      return {
        insert: () => Promise.resolve({ error: null }),
        select: (_columns: string) => ({
          limit: () => Promise.resolve({ error: null }),
        }),
        update(values: Record<string, unknown>) {
          updates.push(values);
          const query = {
            eq: () => query,
            select: (_columns: string) => ({
              maybeSingle: () => Promise.resolve(outcome),
            }),
          };
          return query;
        },
      };
    },
  };
  return { client: client as unknown as LedgerStubClient, updates };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("les tokens Lovable AI restent ceux réellement déclarés", () => {
  assertEquals(
    extractLovableAITokenUsage({
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
        cost: 0.42,
      },
    }),
    {
      totalTokens: 150,
      fields: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
      },
    },
  );

  assertEquals(
    extractLovableAITokenUsage({
      usageMetadata: {
        promptTokenCount: 9,
        candidatesTokenCount: 3,
        totalTokenCount: 12,
      },
    }).totalTokens,
    12,
  );

  assertEquals(
    extractLovableAITokenUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    {
      totalTokens: null,
      fields: { prompt_tokens: 10, completion_tokens: 5 },
    },
  );
});

Deno.test("la request_key Lovable AI est stable pour une même tentative et distincte par essai", () => {
  const first = lovableAIRequestKey("generate_message", "invocation-1", 1);
  assertEquals(
    first,
    lovableAIRequestKey("generate_message", "invocation-1", 1),
  );
  if (first === lovableAIRequestKey("generate_message", "invocation-1", 2)) {
    throw new Error(
      "Deux tentatives fournisseur partagent la même request_key",
    );
  }
});

Deno.test("la cohorte Lovable AI est stable pour le même ensemble", async () => {
  const first = await lovableAICohortKey("tonal_charter", ["b", "a"]);
  const second = await lovableAICohortKey("tonal_charter", ["a", "b"]);
  assertEquals(first, second);
  if (!first.startsWith("tonal_charter:")) {
    throw new Error("La clé de cohorte doit conserver son namespace");
  }
});

Deno.test("un succès HTTP Lovable AI persiste l intention puis les tokens", async () => {
  const rows: ProviderUsageInput[] = [];
  const sequence: string[] = [];
  const result = await callMeteredLovableAI({
    supabase: null,
    apiKey: "test-key",
    operation: "generate_message",
    invocationId: "invocation-1",
    attempt: 1,
    model: "test-model",
    body: { model: "test-model" },
    itemsCount: 1,
    itemBasis: "recipient_submitted",
    signalId: "signal-1",
    contactId: "contact-1",
    fetcher: async () =>
      new Response(
        JSON.stringify({
          id: "provider-response-1",
          choices: [{ message: { content: "Bonjour" } }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
        }),
        { status: 200 },
      ),
    recordUsage: async (row) => {
      sequence.push(row.dispatchStatus === "unconfirmed" ? "intent" : "ledger");
      rows.push(row);
    },
    onResponseObserved: async () => {
      sequence.push("cache");
    },
  });

  assertEquals(result.ok, true);
  assertEquals(rows.length, 2);
  assertEquals(
    rows[0].requestKey,
    "lovable_ai:generate_message:invocation-1:1",
  );
  assertEquals(rows[0].dispatchStatus, "unconfirmed");
  assertEquals(rows[0].requestsCount, 0);
  assertEquals(rows[0].units, 0);
  assertEquals(rows[1].signalId, "signal-1");
  assertEquals(rows[1].contactId, "contact-1");
  assertEquals(rows[1].dispatchStatus, "confirmed");
  assertEquals(rows[1].success, true);
  assertEquals(rows[1].units, 10);
  assertEquals(rows[1].itemsCount, 1);
  assertEquals(rows[1].httpStatus, 200);
  assertEquals(rows[1].costAmount, null);
  assertEquals(rows[1].currency, null);
  assertEquals(rows[1].costSource, null);
  assertEquals(sequence, ["intent", "cache", "ledger"]);
});

Deno.test("le sceau de dispatch tombe après l intention durable et avant le POST", async () => {
  const sequence: string[] = [];
  let sealedRequestKey: string | null = null;

  await callMeteredLovableAI({
    supabase: null,
    apiKey: "test-key",
    operation: "update_tonal_charter",
    invocationId: "run-seal-1",
    attempt: 2,
    model: "test-model",
    body: {},
    itemsCount: 5,
    itemBasis: "feedback_corrections_submitted",
    fetcher: () => {
      sequence.push("post");
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
          { status: 200 },
        ),
      );
    },
    recordUsage: (row) => {
      sequence.push(row.dispatchStatus === "unconfirmed" ? "intent" : "ledger");
      return Promise.resolve();
    },
    onDispatchIntentDurable: ({ requestKey }) => {
      sequence.push("seal");
      sealedRequestKey = requestKey;
      return Promise.resolve();
    },
    onResponseObserved: () => {
      sequence.push("cache");
      return Promise.resolve();
    },
  });

  // L'ordre est la garantie métier : tant que le sceau n'est pas posé, une
  // expiration reste rejouable ; une fois posé, elle devient ambiguë.
  assertEquals(sequence, ["intent", "seal", "post", "cache", "ledger"]);
  assertEquals(sealedRequestKey, "lovable_ai:update_tonal_charter:run-seal-1:2");
});

Deno.test("un sceau de dispatch refusé interdit tout appel payant", async () => {
  const sequence: string[] = [];
  let thrown = false;

  try {
    await callMeteredLovableAI({
      supabase: null,
      apiKey: "test-key",
      operation: "update_tonal_charter",
      invocationId: "run-seal-2",
      attempt: 1,
      model: "test-model",
      body: {},
      itemsCount: 5,
      itemBasis: "feedback_corrections_submitted",
      fetcher: () => {
        sequence.push("post");
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
      recordUsage: (row) => {
        sequence.push(
          row.dispatchStatus === "unconfirmed" ? "intent" : "ledger",
        );
        return Promise.resolve();
      },
      onDispatchIntentDurable: () => {
        sequence.push("seal_failed");
        return Promise.reject(new Error("bail perdu"));
      },
    });
  } catch {
    thrown = true;
  }

  assertEquals(thrown, true);
  // Aucun POST : un appel dont l'état durable ne peut pas porter le résultat
  // ne doit jamais partir.
  assertEquals(sequence, ["intent", "seal_failed"]);
});

Deno.test("une reprise finalise le ledger depuis la réponse cachée sans nouveau POST", async () => {
  const { client, updates } = ledgerStub({ data: { id: "event-1" }, error: null });

  const result = await finalizeLovableAIFromCachedResponse({
    supabase: client,
    operation: "update_tonal_charter",
    requestKey: "lovable_ai:update_tonal_charter:run-1:1",
    model: "test-model",
    attempt: 1,
    invocationId: "run-1",
    itemsCount: 7,
    itemBasis: "feedback_corrections_submitted",
    status: 200,
    payload: {
      id: "provider-response-9",
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
    },
  });

  assertEquals(result, { finalized: true, error: null });
  assertEquals(updates.length, 1);
  assertEquals(updates[0].dispatch_status, "confirmed");
  assertEquals(updates[0].units, 50);
  assertEquals(updates[0].requests_count, 1);
  assertEquals(updates[0].items_count, 7);
  assertEquals(
    (updates[0].metadata as Record<string, unknown>).http_status,
    200,
  );
  assertEquals(
    (updates[0].metadata as Record<string, unknown>).measurement_quality,
    "provider_attempt_observed_from_cache",
  );
  assertEquals(updates[0].success, true);
  // Le coût monétaire reste inconnu : la gateway ne le renvoie pas.
  assertEquals(updates[0].cost_amount, null);
});

Deno.test("une intention déjà confirmée ne fait pas échouer la reprise", async () => {
  const { client } = ledgerStub({ data: null, error: null });

  const result = await finalizeLovableAIFromCachedResponse({
    supabase: client,
    operation: "update_tonal_charter",
    requestKey: "lovable_ai:update_tonal_charter:run-2:1",
    model: "test-model",
    attempt: 1,
    invocationId: "run-2",
    itemsCount: 3,
    itemBasis: "feedback_corrections_submitted",
    status: 200,
    payload: { choices: [{ message: { content: "{}" } }] },
  });

  // Pas d'exception : c'est le cas nominal d'une reprise. L'autorité reste le
  // contrôle SQL `dispatch_status = 'confirmed'` avant d'appliquer la charte.
  assertEquals(result.finalized, false);
  if (!result.error) {
    throw new Error("La raison de non-finalisation doit rester lisible");
  }
});

Deno.test("une réponse cachée en erreur HTTP n est jamais valorisée comme un succès", async () => {
  const { client, updates } = ledgerStub({ data: { id: "event-2" }, error: null });

  await finalizeLovableAIFromCachedResponse({
    supabase: client,
    operation: "update_tonal_charter",
    requestKey: "lovable_ai:update_tonal_charter:run-3:1",
    model: "test-model",
    attempt: 1,
    invocationId: "run-3",
    itemsCount: 3,
    itemBasis: "feedback_corrections_submitted",
    status: 429,
    payload: null,
  });

  assertEquals(updates[0].success, false);
  assertEquals(updates[0].error_code, "http_429");
  assertEquals(updates[0].dispatch_status, "confirmed");
  assertEquals(updates[0].units, 0);
});

Deno.test("un échec réseau Lovable AI reste un dispatch ambigu non valorisé", async () => {
  const rows: ProviderUsageInput[] = [];
  let thrown = false;
  try {
    await callMeteredLovableAI({
      supabase: null,
      apiKey: "test-key",
      operation: "generate_gift_image",
      invocationId: "invocation-2",
      attempt: 1,
      model: "test-model",
      body: {},
      itemsCount: 1,
      itemBasis: "image_requested",
      runId: "gift-1",
      fetcher: async () => {
        throw new TypeError("network down");
      },
      recordUsage: async (row) => {
        rows.push(row);
      },
    });
  } catch {
    thrown = true;
  }

  assertEquals(thrown, true);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].success, false);
  assertEquals(rows[0].errorCode, "dispatch_unconfirmed");
  assertEquals(rows[0].dispatchStatus, "unconfirmed");
  assertEquals(rows[0].requestsCount, 0);
  assertEquals(rows[0].httpStatus, null);
  assertEquals(rows[0].runId, "gift-1");
});

Deno.test("une réponse HTTP en erreur conserve son statut et une clé unique", async () => {
  const rows: ProviderUsageInput[] = [];
  const result = await callMeteredLovableAI({
    supabase: null,
    apiKey: "test-key",
    operation: "update_tonal_charter",
    invocationId: "invocation-3",
    attempt: 1,
    model: "test-model",
    body: {},
    itemsCount: 12,
    itemBasis: "feedback_corrections_submitted",
    fetcher: async () => new Response("quota", { status: 429 }),
    recordUsage: async (row) => {
      rows.push(row);
    },
  });

  assertEquals(result.ok, false);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].dispatchStatus, "unconfirmed");
  assertEquals(rows[1].success, false);
  assertEquals(rows[1].errorCode, "http_429");
  assertEquals(rows[1].dispatchStatus, "confirmed");
  assertEquals(rows[1].httpStatus, 429);
  assertEquals(rows[1].itemsCount, 12);
});

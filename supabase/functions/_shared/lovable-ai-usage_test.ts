import {
  callMeteredLovableAI,
  extractLovableAITokenUsage,
  lovableAICohortKey,
  lovableAIRequestKey,
} from "./lovable-ai-usage.ts";
import type { ProviderUsageInput } from "./provider-usage.ts";

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

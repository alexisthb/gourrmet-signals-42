import {
  dropcontactBalanceMetadata,
  dropcontactEmailQualifications,
  dropcontactSubmissionKeys,
  findDropcontactResult,
  parseDropcontactCreditsLeft,
  pickVerifiedEmail,
  pollDropcontactBatch,
  submitDropcontactBatch,
} from "./dropcontact.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(message ?? `Expected ${right}, received ${left}`);
}

function fakeProviderLedger(options: { failInsert?: boolean; failFinalize?: boolean } = {}) {
  const events: string[] = [];
  let row: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      insert: async (value: Record<string, unknown>) => {
        events.push("intent");
        if (options.failInsert || row) {
          return { error: { code: row ? "23505" : "XX000", message: "intent refused" } };
        }
        row = { id: "usage-1", ...value };
        return { error: null };
      },
      update: (value: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq(column: string, expected: unknown) {
            filters.push([column, expected]);
            return builder;
          },
          select() {
            return {
              maybeSingle: async () => {
                if (options.failFinalize) {
                  return { data: null, error: { message: "finalize refused" } };
                }
                if (!row || filters.some(([column, expected]) => row?.[column] !== expected)) {
                  return { data: null, error: null };
                }
                row = { ...row, ...value };
                events.push("finalized");
                return { data: { id: row.id }, error: null };
              },
            };
          },
        };
        return builder;
      },
    }),
  };
  return { client, events, getRow: () => row };
}

Deno.test("Dropcontact persiste une intention stable avant POST puis finalise la meme ligne", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger();
  const firstKeys = dropcontactSubmissionKeys("enrichment-1");
  assertEquals(dropcontactSubmissionKeys("enrichment-1"), firstKeys);
  globalThis.fetch = async () => {
    assertEquals(ledger.events, ["intent"]);
    assertEquals(ledger.getRow()?.dispatch_status, "unconfirmed");
    assertEquals(ledger.getRow()?.requests_count, 0);
    assertEquals(ledger.getRow()?.business_key, firstKeys.businessKey);
    ledger.events.push("fetch");
    return new Response(JSON.stringify({ request_id: "request-1", credits_left: 12 }), { status: 200 });
  };
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada", last_name: "Lovelace" }],
      {
        supabase: ledger.client,
        enrichmentId: "enrichment-1",
        signalId: "signal-1",
      },
    );
    assertEquals(result, { request_id: "request-1" });
    assertEquals(ledger.events, ["intent", "fetch", "finalized"]);
    const row = ledger.getRow();
    assertEquals(row?.request_key, firstKeys.requestKey);
    assertEquals(row?.business_key, firstKeys.businessKey);
    assertEquals(row?.dispatch_status, "confirmed");
    assertEquals((row?.metadata as Record<string, unknown>)?.provider_request_id, "request-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Dropcontact separe la generation fournisseur de la ligne enrichissement", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger();
  const keys = dropcontactSubmissionKeys("job-2");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ request_id: "request-2" }), { status: 200 });
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada" }],
      {
        supabase: ledger.client,
        enrichmentId: "enrichment-1",
        operationGeneration: "job-2",
        signalId: "signal-1",
      },
    );
    assertEquals(result, { request_id: "request-2" });
    assertEquals(ledger.getRow()?.request_key, keys.requestKey);
    assertEquals(ledger.getRow()?.run_id, "enrichment-1");
    assertEquals(
      ((ledger.getRow()?.metadata as Record<string, unknown>) || {}).operation_generation,
      "job-2",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Dropcontact ne POST jamais si l'intention durable est refusee", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger({ failInsert: true });
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada" }],
      { supabase: ledger.client, enrichmentId: "enrichment-1", signalId: "signal-1" },
    );
    assertEquals("ledger_error" in result ? result.ledger_error : false, true);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("un crash logique apres reponse garde l'intention Dropcontact non confirmee", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger({ failFinalize: true });
  globalThis.fetch = async () => new Response(JSON.stringify({ request_id: "request-1" }), { status: 200 });
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada" }],
      { supabase: ledger.client, enrichmentId: "enrichment-1", signalId: "signal-1" },
    );
    assertEquals("uncertain" in result ? result.uncertain : false, true);
    assertEquals(ledger.getRow()?.dispatch_status, "unconfirmed");
    assertEquals(
      ((ledger.getRow()?.metadata as Record<string, unknown>) || {}).provider_request_id,
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("une reponse Dropcontact sans request_id reste terminale et non rejouable", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger();
  globalThis.fetch = async () => new Response(JSON.stringify({ request_id: "   " }), { status: 200 });
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada" }],
      { supabase: ledger.client, enrichmentId: "enrichment-1", signalId: "signal-1" },
    );
    assertEquals("uncertain" in result ? result.uncertain : false, true);
    assertEquals(ledger.getRow()?.dispatch_status, "confirmed");
    assertEquals(
      ((ledger.getRow()?.metadata as Record<string, unknown>) || {}).provider_request_id,
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("Dropcontact exige une qualification fournisseur explicitement verifiee", () => {
  const selected = pickVerifiedEmail([
    { email: "generic@acme.test", qualification: "generic@pro" },
    { email: "ada@acme.test", qualification: "nominative@pro" },
  ]);

  assertEquals(selected, {
    email: "ada@acme.test",
    qualification: "nominative@pro",
    verification_status: "verified",
    provider: "dropcontact",
    confidence: null,
  });
});

Deno.test("Dropcontact rejette absence de statut, catch-all, generique et invalide", () => {
  assertEquals(pickVerifiedEmail([{ email: "ada@acme.test" }]), null);
  assertEquals(pickVerifiedEmail([{ email: "ada@acme.test", qualification: "catch_all@pro" }]), null);
  assertEquals(pickVerifiedEmail([{ email: "contact@acme.test", qualification: "generic@pro" }]), null);
  assertEquals(pickVerifiedEmail([{ email: "ada@acme.test", qualification: "nominative@invalid" }]), null);
});

Deno.test("les qualifications rejetees restent auditables sans accepter leur email", () => {
  const emails = [
    { email: "contact@acme.test", qualification: "generic@pro" },
    { email: "ada@acme.test", qualification: "catch_all@pro" },
  ];
  assertEquals(pickVerifiedEmail(emails), null);
  assertEquals(dropcontactEmailQualifications(emails), ["generic@pro", "catch_all@pro"]);
});

Deno.test("Dropcontact rejette aussi une chaine qui ne ressemble pas a un email", () => {
  assertEquals(pickVerifiedEmail([{ email: "not-an-email", qualification: "nominative@pro" }]), null);
});

Deno.test("les resultats Dropcontact sont relies par identifiant et jamais par ordre aveugle", () => {
  const results = [
    { first_name: "Grace", last_name: "Hopper", custom_fields: { gourrmet_candidate_id: "c2" } },
    { first_name: "Ada", last_name: "Lovelace", custom_fields: { gourrmet_candidate_id: "c1" } },
  ];
  assertEquals(findDropcontactResult(results, "c1", { first_name: "Ada", last_name: "Lovelace" })?.first_name, "Ada");
  assertEquals(findDropcontactResult(results, "missing", { first_name: "Nobody", last_name: "Here" }), null);
});

Deno.test("un ledger Dropcontact non persiste arrete le polling avant l'appel suivant", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ success: false }), { status: 200 });
  };
  try {
    const result = await pollDropcontactBatch(
      "test-key",
      "request-id",
      { maxAttempts: 3, delayMs: 0 },
      async () => { throw new Error("ledger indisponible"); },
    );
    assertEquals("ledger_error" in result ? result.ledger_error : false, true);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("le solde Dropcontact est accepte uniquement comme entier fournisseur explicite", () => {
  assertEquals(parseDropcontactCreditsLeft({ credits_left: 42 }), 42);
  assertEquals(parseDropcontactCreditsLeft({ credits_left: 0 }), 0);
  assertEquals(parseDropcontactCreditsLeft({ credits_left: "42" }), null);
  assertEquals(parseDropcontactCreditsLeft({ credits_left: 1.5 }), null);
  assertEquals(parseDropcontactCreditsLeft({}), null);
  assertEquals(parseDropcontactCreditsLeft(null), null);
  assertEquals(dropcontactBalanceMetadata({
    operation: "enrich_submit",
    providerRequestId: "request-id",
    attempt: 1,
    success: true,
    httpStatus: 200,
    itemsCount: 1,
    errorCode: null,
    creditsLeft: 42,
  }), {
    credits_left: 42,
    balance_unit: "credits",
    balance_source: "provider_api",
    provider_reported_field: "credits_left",
    balance_measurement_quality: "provider_reported",
  });
});

Deno.test("la soumission propage le credits_left exact dans le ledger", async () => {
  const originalFetch = globalThis.fetch;
  const ledger = fakeProviderLedger();
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    request_id: "request-submit",
    credits_left: 37,
  }), { status: 200 });
  try {
    const result = await submitDropcontactBatch(
      "test-key",
      [{ first_name: "Ada", last_name: "Lovelace", company: "Analytical Engines" }],
      { supabase: ledger.client, enrichmentId: "enrichment-1", signalId: "signal-1" },
    );
    assertEquals(result, { request_id: "request-submit" });
    const row = ledger.getRow();
    assertEquals(row?.requests_count, 1);
    assertEquals(row?.items_count, 1);
    assertEquals((row?.metadata as Record<string, unknown>)?.credits_left, 37);
    assertEquals(
      (row?.metadata as Record<string, unknown>)?.balance_measurement_quality,
      "provider_reported",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("le polling garde le solde a null quand le payload ne le fournit pas", async () => {
  const originalFetch = globalThis.fetch;
  const usages: unknown[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    reason: "Request not ready yet",
  }), { status: 200 });
  try {
    const result = await pollDropcontactBatch(
      "test-key",
      "request-pending",
      { maxAttempts: 1, delayMs: 0 },
      async (usage) => { usages.push(usage); },
    );
    assertEquals("pending" in result ? result.pending : false, true);
    assertEquals(usages, [{
      operation: "enrich_poll",
      providerRequestId: "request-pending",
      attempt: 1,
      success: true,
      httpStatus: 200,
      itemsCount: 0,
      errorCode: null,
      creditsLeft: null,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("le polling final propage aussi le credits_left exact", async () => {
  const originalFetch = globalThis.fetch;
  const usages: unknown[] = [];
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: [],
    credits_left: 36,
  }), { status: 200 });
  try {
    const result = await pollDropcontactBatch(
      "test-key",
      "request-complete",
      { maxAttempts: 1, delayMs: 0 },
      async (usage) => { usages.push(usage); },
    );
    assertEquals(result, { data: [] });
    assertEquals(usages, [{
      operation: "enrich_poll",
      providerRequestId: "request-complete",
      attempt: 1,
      success: true,
      httpStatus: 200,
      itemsCount: 0,
      errorCode: null,
      creditsLeft: 36,
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

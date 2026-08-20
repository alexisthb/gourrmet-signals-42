import { buildProviderUsageRow } from "./provider-usage.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("le ledger garde cout inconnu a null et les volumes observes exacts", () => {
  const row = buildProviderUsageRow({
    provider: "apify",
    operation: "linkedin_company_search",
    requestKey: "req-1",
    signalId: "signal-1",
    runId: "run-1",
    success: true,
    units: 0,
    itemsCount: 3,
    httpStatus: 200,
    metadata: { unit_basis: "not_returned_by_provider" },
  });
  assertEquals(row.cost_amount, null);
  assertEquals(row.units, 0);
  assertEquals(row.requests_count, 1);
  assertEquals(row.items_count, 3);
  assertEquals(row.metadata, {
    unit_basis: "not_returned_by_provider",
    http_status: 200,
  });
  assertEquals(row.dispatch_status, "confirmed");
});

Deno.test("un cout fournisseur exact reste attache a la run sans inventer une requete", () => {
  const row = buildProviderUsageRow({
    provider: "apify",
    operation: "actor_run_cost",
    requestKey: "apify:actor_run_cost:run-1",
    signalId: "signal-1",
    runId: "enrichment-1",
    success: true,
    units: 1,
    requestsCount: 0,
    itemsCount: 0,
    costAmount: 0.2654,
    currency: "USD",
    costSource: "provider_api",
  });
  if (
    row.cost_amount !== 0.2654 || row.currency !== "USD" ||
    row.cost_source !== "provider_api"
  ) {
    throw new Error("Le coût Apify exact n'est pas conservé");
  }
  if (row.requests_count !== 0) {
    throw new Error(
      "Le coût d'une run ne doit pas compter un second appel HTTP",
    );
  }
});

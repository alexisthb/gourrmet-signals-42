import {
  buildEmployeeSearchInput,
  checkApifyRun,
  classifyOperationalPersonas,
  extractEmployee,
  resolveCompanyCandidate,
  submitCompanyEmployeesRun,
  type Persona,
} from "./apify-linkedin.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(message ?? `Expected ${right}, received ${left}`);
}

const PERSONAS: Persona[] = [
  { name: "Workplace Experience Lead", isPriority: true },
  { name: "Responsable achats", isPriority: false },
];

Deno.test("la resolution societe choisit le meilleur candidat et non le premier", () => {
  const result = resolveCompanyCandidate("Acme France SAS", [
    { name: "Acme Consulting", linkedinUrl: "https://www.linkedin.com/company/acme-consulting" },
    { name: "ACME France", linkedinUrl: "https://www.linkedin.com/company/acme-france" },
  ]);

  assertEquals(result.status, "resolved");
  assertEquals(result.linkedinUrl, "https://www.linkedin.com/company/acme-france");
  assertEquals(result.score, 100);
  assertEquals(result.provenance.provider, "apify");
  assertEquals(result.provenance.actor, "harvestapi/linkedin-company-search");
});

Deno.test("la resolution societe refuse un duel ambigu et un candidat sans preuve", () => {
  const ambiguous = resolveCompanyCandidate("Orange", [
    { name: "Orange Business", linkedinUrl: "https://www.linkedin.com/company/orange-business" },
    { name: "Orange Bank", linkedinUrl: "https://www.linkedin.com/company/orange-bank" },
  ]);
  assertEquals(ambiguous.status, "ambiguous");
  assertEquals(ambiguous.linkedinUrl, null);

  const rejected = resolveCompanyCandidate("Maison Gourmet", [
    { name: "Maison Gourmande" },
  ]);
  assertEquals(rejected.status, "rejected");
  assertEquals(rejected.linkedinUrl, null);
});

Deno.test("les personas configures sont vraiment transmis a HarvestAPI", () => {
  const input = buildEmployeeSearchInput("https://www.linkedin.com/company/acme", PERSONAS);
  assertEquals(input.jobTitles, ["Workplace Experience Lead", "Responsable achats"]);
  assertEquals(input.searchQuery, '"Workplace Experience Lead" OR "Responsable achats"');
});

Deno.test("le mapping HarvestAPI lit actor.name et actor.position sans fabriquer undefined undefined", () => {
  const employee = extractEmployee({
    actor: {
      name: "Ada Lovelace",
      position: "Workplace Experience Lead",
      linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
    },
  });
  assertEquals(employee.first_name, "Ada");
  assertEquals(employee.last_name, "Lovelace");
  assertEquals(employee.full_name, "Ada Lovelace");
  assertEquals(employee.job_title, "Workplace Experience Lead");

  const empty = extractEmployee({ actor: { name: "undefined undefined", position: "undefined" } });
  assertEquals(empty.full_name, null);
  assertEquals(empty.job_title, null);
});

Deno.test("la resolution contact expose resolved ambiguous rejected et les compte", () => {
  const result = classifyOperationalPersonas([
    {
      actor: {
        name: "Ada Lovelace",
        position: "Workplace Experience Lead",
        linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
      },
    },
    { actor: { name: "Grace Hopper", position: "Workplace Experience Lead" } },
    {
      actor: {
        name: "Prince",
        position: "Workplace Experience Lead",
        linkedinUrl: "https://www.linkedin.com/in/prince",
      },
    },
    {
      actor: {
        name: "Linus Torvalds",
        position: "Chief Technology Officer",
        linkedinUrl: "https://www.linkedin.com/in/linus-torvalds",
      },
    },
  ], PERSONAS);

  assertEquals(result.counts, { resolved: 1, ambiguous: 2, rejected: 1 });
  assertEquals(result.resolved.length, 1);
  assertEquals(result.resolved[0].persona_name, "Workplace Experience Lead");
  assertEquals(result.resolved[0].resolution_status, "resolved");
});

Deno.test("un ledger Apify non persiste interdit la soumission employees suivante", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify([
      { name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" },
    ]), { status: 200 });
  };
  try {
    const result = await submitCompanyEmployeesRun("test-key", "Acme", PERSONAS, async () => {
      throw new Error("ledger indisponible");
    });
    assertEquals("error" in result, true);
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("une resolution durable evite de repayer la recherche societe", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      data: { id: "run-1", defaultDatasetId: "dataset-1" },
    }), { status: 201 });
  };
  const resolution = resolveCompanyCandidate("Acme", [{
    name: "Acme",
    linkedinUrl: "https://www.linkedin.com/company/acme",
  }]);
  try {
    const operations: string[] = [];
    const result = await submitCompanyEmployeesRun(
      "test-key",
      "Acme",
      PERSONAS,
      async (usage) => {
        operations.push(usage.operation);
      },
      resolution,
    );
    assertEquals("runId" in result ? result.runId : null, "run-1");
    assertEquals(calls, 1);
    assertEquals(operations, ["linkedin_employee_submit"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("le poll Apify expose le cout USD final renvoye par le fournisseur", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      status: "SUCCEEDED",
      defaultDatasetId: "dataset-1",
      finishedAt: "2026-08-20T12:00:00.000Z",
      usageTotalUsd: 0.2654,
    },
  }), { status: 200 });
  try {
    const run = await checkApifyRun("test-key", "run-1", async () => {});
    assertEquals(run, {
      status: "SUCCEEDED",
      datasetId: "dataset-1",
      finishedAt: "2026-08-20T12:00:00.000Z",
      usageTotalUsd: 0.2654,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import {
  buildEmployeeSearchInput,
  checkApifyRun,
  classifyOperationalPersonas,
  extractEmployee,
  resolveCompanyCandidate,
  submitCompanyEmployeesRun,
  type Persona,
  bestLinkedInProfileUrl,
  isOpaqueLinkedInProfileSlug,
  profileUrlFromPublicIdentifier,
  normalizeCompanyName,
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

// Mesure du 2026-08-21 : envoyer les personas comme filtre a l'acteur vidait
// les datasets (de 6-100 profils a 0-1). Les personas se filtrent COTE CLIENT.
// Ce test verrouille l'absence de tout filtre serveur — c'est ce qui garde le
// tuyau a contacts ouvert.
Deno.test("aucun filtre de titre n'est envoye a HarvestAPI : on ramene puis on filtre", () => {
  const input = buildEmployeeSearchInput("https://www.linkedin.com/company/acme", PERSONAS) as Record<
    string,
    unknown
  >;
  assertEquals(input.jobTitles, undefined);
  assertEquals(input.searchQuery, undefined);
  assertEquals(input.companies, ["https://www.linkedin.com/company/acme"]);
  assertEquals(input.maxItems, 100);
  assertEquals(input.locations, ["France"]);
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

// ---------------------------------------------------------------------------
// URL de profil LinkedIn : nom public contre identifiant interne.
// Regression de juillet 2026 — l'extracteur stockait l'URN, et l'URL obtenue
// n'ouvrait aucun profil consultable.
// ---------------------------------------------------------------------------

Deno.test("un identifiant interne LinkedIn est reconnu comme opaque", () => {
  for (
    const slug of [
      "ACwAAD9yy7YBveQhMAfTt-4Pdto",
      "ACwAABbj2MkBX82tESYzzJYZuwORbyWD0IwTsGk",
      "ACoAAAAfo9QBBCPKd0LXcnYiGY0xyz123",
    ]
  ) {
    if (!isOpaqueLinkedInProfileSlug(slug)) {
      throw new Error(`${slug} aurait du etre reconnu comme opaque`);
    }
  }
  // Des noms publics reels ne doivent JAMAIS etre pris pour des URN.
  for (
    const slug of [
      "alix-guitton",
      "jean-michel-chaussat-1a2b3c",
      "acourtois",          // commence par "ac" mais court et lisible
      "marie",
      "ACME-conseil",       // majuscules, mais avec un tiret et court
    ]
  ) {
    if (isOpaqueLinkedInProfileSlug(slug)) {
      throw new Error(`${slug} est un nom public, pas un URN`);
    }
  }
});

Deno.test("le nom public l emporte toujours sur l identifiant interne", () => {
  assertEquals(
    bestLinkedInProfileUrl([
      "https://www.linkedin.com/in/ACwAAD9yy7YBveQhMAfTt-4Pdto",
      "https://www.linkedin.com/in/alix-guitton",
    ]),
    "https://www.linkedin.com/in/alix-guitton",
  );
  // ...quel que soit l'ordre d'arrivee des candidats.
  assertEquals(
    bestLinkedInProfileUrl([
      "https://www.linkedin.com/in/alix-guitton",
      "https://www.linkedin.com/in/ACwAAD9yy7YBveQhMAfTt-4Pdto",
    ]),
    "https://www.linkedin.com/in/alix-guitton",
  );
});

Deno.test("faute de mieux, l identifiant interne est conserve", () => {
  // Une URL opaque reste preferable a l'absence d'URL : on ne detruit pas de
  // donnee, on la classe.
  assertEquals(
    bestLinkedInProfileUrl([
      null,
      "pas une url",
      "https://www.linkedin.com/in/ACwAAD9yy7YBveQhMAfTt-4Pdto",
    ]),
    "https://www.linkedin.com/in/ACwAAD9yy7YBveQhMAfTt-4Pdto",
  );
  assertEquals(bestLinkedInProfileUrl([null, undefined, "", "https://example.com/x"]), null);
});

Deno.test("une page entreprise n est jamais prise pour un profil de personne", () => {
  assertEquals(
    bestLinkedInProfileUrl(["https://www.linkedin.com/company/ovhcloud"]),
    null,
  );
});

Deno.test("un identifiant public nu est reconstruit en URL complete", () => {
  assertEquals(
    profileUrlFromPublicIdentifier("alix-guitton"),
    "https://www.linkedin.com/in/alix-guitton",
  );
  assertEquals(
    profileUrlFromPublicIdentifier("https://www.linkedin.com/in/alix-guitton/"),
    "https://www.linkedin.com/in/alix-guitton",
  );
  // Un URN presente comme identifiant public est refuse : il ne vaut pas mieux
  // sous ce nom-la.
  assertEquals(
    profileUrlFromPublicIdentifier("ACwAAD9yy7YBveQhMAfTt-4Pdto"),
    null,
  );
  assertEquals(profileUrlFromPublicIdentifier(null), null);
  assertEquals(profileUrlFromPublicIdentifier(""), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// La correspondance des personas, éprouvée sur des intitulés RÉELS.
//
// Tous les titres ci-dessous viennent de la base de production Gourrmet
// (contacts déjà remontés) ou des profils rapatriés le 2026-08-21. Aucun n'est
// inventé : c'est ce que les gens écrivent vraiment sur LinkedIn.
//
// Mesure qui a motivé ce test : 486 profils rejetés sur 492 rapatriés, dont
// deux entreprises à 100 profils et zéro contact retenu.
// ═══════════════════════════════════════════════════════════════════════════
const PERSONAS_PROD: Persona[] = [
  { name: "Assistant(e) de direction", isPriority: true },
  { name: "Office Manager", isPriority: true },
  { name: "Responsable Communication", isPriority: true },
  { name: "Responsable RH", isPriority: true },
  { name: "Directeur Général", isPriority: true },
  { name: "Responsable Événementiel", isPriority: true },
  { name: "Directeur Marketing", isPriority: false },
  { name: "DAF / CFO", isPriority: false },
  { name: "Responsable Achats", isPriority: false },
  { name: "Secrétaire Général", isPriority: false },
];

function personaOf(title: string): string | null {
  const [decision] = classifyOperationalPersonas(
    [{ actor: { name: "Jean Test", position: title, linkedinUrl: "https://www.linkedin.com/in/jean-test" } }],
    PERSONAS_PROD,
  ).decisions;
  return decision?.persona_name ?? null;
}

Deno.test("le feminin ne fait plus rater un decideur", () => {
  // « Directrice Générale » : ni l'un ni l'autre n'est préfixe de l'autre.
  // L'ancienne règle rejetait donc toutes les dirigeantes.
  assertEquals(personaOf("Directrice Générale"), "Directeur Général");
  assertEquals(personaOf("Directrice des opérations - ADHAP Laval"), null,
    "une directrice des operations n'est pas une DG : on ne doit pas tout ratisser");
  assertEquals(personaOf("Présidente"), "Directeur Général");
  assertEquals(personaOf("Acheteuse"), "Responsable Achats");
});

Deno.test("l'acronyme RH ne fait plus rater les ressources humaines", () => {
  assertEquals(personaOf("Responsable des Ressources Humaines"), "Responsable RH");
  assertEquals(personaOf("Responsable Ressources Humaines et Paie"), "Responsable RH");
  assertEquals(personaOf("HR Business Partner"), "Responsable RH");
  assertEquals(personaOf("Human Resources Team Lead"), "Responsable RH");
  assertEquals(personaOf("Talent Acquisition Manager"), "Responsable RH");
  assertEquals(personaOf("Senior People Operations Manager"), "Responsable RH");
});

Deno.test("les intitules anglais courants sont reconnus", () => {
  assertEquals(personaOf("Head of Marketing & Communications"), "Responsable Communication");
  assertEquals(personaOf("Executive Assistant"), "Assistant(e) de direction");
  assertEquals(personaOf("Managing Director"), "Directeur Général");
  assertEquals(personaOf("Chief Financial Officer"), "DAF / CFO");
  assertEquals(personaOf("Senior Global Marketing Event Manager"), "Responsable Événementiel");
});

Deno.test("les intitules francais reels du stock de lundi sont reconnus", () => {
  assertEquals(personaOf("Assistante de direction"), "Assistant(e) de direction");
  assertEquals(personaOf("Responsable du Pôle Communication et Influence"), "Responsable Communication");
  assertEquals(personaOf("Responsable des Relations Presse"), "Responsable Communication");
  assertEquals(personaOf("Directeur Administratif et Financier"), "DAF / CFO");
  assertEquals(personaOf("Responsable Achats emballages papier/carton"), "Responsable Achats");
  assertEquals(personaOf("Directeur d'Usine (Managing Director)"), "Directeur Général");
});

Deno.test("l'elargissement ne devient pas un ratissage aveugle", () => {
  // Ces intitules existent dans le stock de production et ne sont PAS des
  // interlocuteurs cadeaux d'entreprise. Ils doivent rester ecartes, sinon
  // l'operatrice se retrouve avec cent fiches sans valeur par entreprise.
  assertEquals(personaOf("Maître d'hôtel"), null);
  assertEquals(personaOf("Réceptionniste"), null);
  assertEquals(personaOf("Chef exécutif"), null);
  assertEquals(personaOf("Solution Consultant"), null);
  assertEquals(personaOf("Biocompatibility Project Manager Assistant"), null);
  assertEquals(personaOf("Responsable Pôle Aérien FTTH"), null);
  assertEquals(personaOf("Développeur full-stack"), null);
  assertEquals(personaOf("Technicien de maintenance"), null);
});

// ---------------------------------------------------------------------------
// Le nom légal Pappers contre la marque LinkedIn.
// Ces cinq noms ont renvoyé ZÉRO candidat à la recherche société le
// 2026-08-21, parce que la voie d'appel réellement utilisée passait le nom
// brut sans le normaliser — alors que l'autre voie le normalisait déjà.
// ---------------------------------------------------------------------------
Deno.test("le nom legal Pappers est ramene a la marque avant la recherche", () => {
  assertEquals(normalizeCompanyName("AKKODIS HIGH TECH SAS"), "AKKODIS HIGH TECH");
  assertEquals(normalizeCompanyName("C SAGE SARL"), "C SAGE");
  assertEquals(normalizeCompanyName("YOKOHAMA TWS FRANCE SAS"), "YOKOHAMA TWS");
  assertEquals(normalizeCompanyName("BPREX HEALTHCARE OFFRANVILLE"), "BPREX HEALTHCARE OFFRANVILLE");
  // Une marque qui CONTIENT France ne doit pas etre amputee : il ne reste
  // qu'un mot devant, donc « France » fait partie du nom.
  assertEquals(normalizeCompanyName("VECTOR FRANCE"), "VECTOR FRANCE");
  // Un nom deja propre traverse sans dommage.
  assertEquals(normalizeCompanyName("NAMSA"), "NAMSA");
  assertEquals(normalizeCompanyName("COULIDOOR"), "COULIDOOR");
});

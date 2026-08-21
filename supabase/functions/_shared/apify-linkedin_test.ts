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
  brandFromWebsite,
  chooseCompanySearchQuery,
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

Deno.test("la forme juridique placee DEVANT le nom est retiree aussi", () => {
  // « SAS D'AVAUX » partait tel quel a la recherche LinkedIn : seule la forme
  // juridique en FIN de nom etait retiree.
  assertEquals(normalizeCompanyName("SAS D'AVAUX"), "D'AVAUX");
  assertEquals(normalizeCompanyName("SARL Martin Freres"), "Martin Freres");
  assertEquals(normalizeCompanyName("SASU Duval"), "Duval");
  // Un nom qui COMMENCE par ces lettres sans que ce soit une forme juridique
  // ne doit pas etre ampute : il faut un mot entier suivi d'un espace.
  assertEquals(normalizeCompanyName("SASHA COSMETICS"), "SASHA COSMETICS");
  assertEquals(normalizeCompanyName("SARLAT DISTRIBUTION"), "SARLAT DISTRIBUTION");
  // « SE » et « SA » en tete sont bien plus souvent une marque qu'une forme
  // juridique : on ne les touche pas.
  assertEquals(normalizeCompanyName("SA BRASSERIE"), "SA BRASSERIE");
});

// ═══════════════════════════════════════════════════════════════════════════
// Choix de la requête envoyée au fournisseur : nom légal ou marque du site.
//
// Les huit cas ci-dessous sont les huit signaux réellement bloqués le
// 2026-08-21, avec leur site tel qu'il est en base. Le point délicat n'est pas
// de faire basculer AKKODIS — c'est de NE PAS faire basculer PRISMA et C SAGE,
// dont le domaine désigne la maison mère ou le réseau, pas l'établissement.
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("la marque du site remplace un libelle administratif, jamais une marque", () => {
  // Libellés administratifs (3 mots ou plus) -> on bascule sur le site.
  assertEquals(
    chooseCompanySearchQuery("AKKODIS HIGH TECH SAS", "https://www.akkodis.com/fr"),
    { query: "akkodis", source: "website_brand" },
  );
  assertEquals(
    chooseCompanySearchQuery("MGEN ACTION SANITAIRE ET SOCIALE", "https://www.mgen.fr"),
    { query: "mgen", source: "website_brand" },
  );

  // LE PIÈGE : noms courts = déjà des marques. Le domaine pointe vers la
  // maison mère (Gestamp) ou le réseau de franchise (Adhap) — on n'y touche
  // pas, sous peine de remonter les contacts du groupe au lieu de ceux de
  // l'établissement détecté.
  assertEquals(
    chooseCompanySearchQuery("PRISMA", "https://www.gestamp.com/About-Us/France/Gestamp-Prisma"),
    { query: "PRISMA", source: "legal_name" },
  );
  assertEquals(
    chooseCompanySearchQuery("C SAGE SARL", "https://www.adhap.fr/agences/centre/bonchamp-les-laval/"),
    { query: "C SAGE", source: "legal_name" },
  );
  assertEquals(
    chooseCompanySearchQuery("SAS D'AVAUX", "https://www.champsdavaux.com"),
    { query: "D'AVAUX", source: "legal_name" },
  );

  // Deux mots : déjà exploitable, on garde.
  assertEquals(
    chooseCompanySearchQuery("YOKOHAMA TWS FRANCE SAS", "https://www.yokohama-tws.com/fr-fr"),
    { query: "YOKOHAMA TWS", source: "legal_name" },
  );
  assertEquals(
    chooseCompanySearchQuery("FIBER ACADEMY", "https://fiber-academy.com"),
    { query: "FIBER ACADEMY", source: "legal_name" },
  );

  // Sans site, on ne peut que garder le nom.
  assertEquals(
    chooseCompanySearchQuery("COULIDOOR", null),
    { query: "COULIDOOR", source: "legal_name" },
  );
  assertEquals(
    chooseCompanySearchQuery("BPREX HEALTHCARE OFFRANVILLE", null),
    { query: "BPREX HEALTHCARE OFFRANVILLE", source: "legal_name" },
  );
});

Deno.test("la marque est extraite du domaine, pas du chemin", () => {
  assertEquals(brandFromWebsite("https://www.yokohama-tws.com/fr-fr"), "yokohama tws");
  assertEquals(brandFromWebsite("https://www.mgen.fr"), "mgen");
  assertEquals(brandFromWebsite("akkodis.com"), "akkodis");
  assertEquals(brandFromWebsite("https://www.example.co.uk/page"), "example");
  // Rien d'exploitable : pas de marque plutôt qu'une marque fausse.
  assertEquals(brandFromWebsite(null), null);
  assertEquals(brandFromWebsite("pas une url"), null);
  assertEquals(brandFromWebsite("https://localhost"), null);
  assertEquals(brandFromWebsite("https://ab.fr"), null);
});

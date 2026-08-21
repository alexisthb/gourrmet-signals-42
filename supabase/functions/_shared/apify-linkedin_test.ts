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
  resolveScraperMode,
  mergeFullProfiles,
  looksTruncatedLastName,
  fetchFullProfiles,
  profileUrnKey,
  personKey,
  personInitialKey,
  companyLogoUrlFromSearchItem,
  resolveProfileMode,
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

// ---------------------------------------------------------------------------
// Mode de scraping : réglable en base pour qu'un essai soit ANNULABLE sans
// redéploiement. Le garde-fou compte autant que le réglage — le défaut de
// l'acteur est le mode à 8 $/1000, deux fois le nôtre.
// ---------------------------------------------------------------------------
Deno.test("un mode inconnu ou absent retombe sur le mode economique", () => {
  assertEquals(resolveScraperMode(null), "Short ($4 per 1k)");
  assertEquals(resolveScraperMode(undefined), "Short ($4 per 1k)");
  assertEquals(resolveScraperMode(""), "Short ($4 per 1k)");
  // Une faute de frappe en base ne doit pas pouvoir doubler la facture.
  assertEquals(resolveScraperMode("Full"), "Short ($4 per 1k)");
  assertEquals(resolveScraperMode("full ($8 per 1k)"), "Short ($4 per 1k)");
});

Deno.test("les trois modes reels de l'acteur sont acceptes tels quels", () => {
  assertEquals(resolveScraperMode("Short ($4 per 1k)"), "Short ($4 per 1k)");
  assertEquals(resolveScraperMode("Full ($8 per 1k)"), "Full ($8 per 1k)");
  assertEquals(
    resolveScraperMode("Full + email search ($12 per 1k)"),
    "Full + email search ($12 per 1k)",
  );
});

Deno.test("le mode choisi arrive vraiment dans l'entree envoyee a l'acteur", () => {
  const court = buildEmployeeSearchInput("https://www.linkedin.com/company/acme", PERSONAS) as Record<string, unknown>;
  assertEquals(court.profileScraperMode, "Short ($4 per 1k)");
  const complet = buildEmployeeSearchInput(
    "https://www.linkedin.com/company/acme", PERSONAS, "Full ($8 per 1k)",
  ) as Record<string, unknown>;
  assertEquals(complet.profileScraperMode, "Full ($8 per 1k)");
  // Et le filtre de titres reste absent quel que soit le mode.
  assertEquals(complet.jobTitles, undefined);
  assertEquals(complet.searchQuery, undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// Second étage : recoller les profils complets sur les seuls candidats retenus.
//
// Données réelles de l'essai JALIOS du 2026-08-21 : le scan économique avait
// rendu « Aurélia D. » avec un identifiant interne ; le profil complet rend
// « aurelia-dostert-marketing-com ».
// ═══════════════════════════════════════════════════════════════════════════
const URN_AURELIA = "https://www.linkedin.com/in/ACwAAAatW8wB0mFvjXfqv_4NLS9ioim7M-scfqM";
const URN_VINCENT = "https://www.linkedin.com/in/ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k";

Deno.test("un patronyme reduit a une initiale est reconnu comme tronque", () => {
  assertEquals(looksTruncatedLastName("D."), true);
  assertEquals(looksTruncatedLastName("D"), true);
  assertEquals(looksTruncatedLastName(null), true);
  assertEquals(looksTruncatedLastName(""), true);
  // De vrais patronymes courts ne doivent PAS etre pris pour des troncatures.
  assertEquals(looksTruncatedLastName("Li"), false);
  assertEquals(looksTruncatedLastName("Wu"), false);
  assertEquals(looksTruncatedLastName("Dostert"), false);
  assertEquals(looksTruncatedLastName("Bouthors"), false);
});

Deno.test("le second etage repare l'URL et le patronyme, sans toucher au reste", () => {
  const candidats = [
    {
      first_name: "Aurélia", last_name: "D.", full_name: "Aurélia D.",
      job_title: "Growth Marketing & Communication Manager",
      linkedin_url: URN_AURELIA, location: "Paris",
      persona_name: "Responsable Communication", persona_priority: true,
    },
    {
      first_name: "Vincent", last_name: "Bouthors", full_name: "Vincent Bouthors",
      job_title: "CEO", linkedin_url: URN_VINCENT, location: null,
      persona_name: "Directeur Général", persona_priority: true,
    },
  ];
  const complets = [
    {
      sourceUrl: URN_AURELIA,
      publicUrl: "https://www.linkedin.com/in/aurelia-dostert-marketing-com",
      firstName: "Aurélia",
      lastName: "Dostert",
    },
    {
      sourceUrl: URN_VINCENT,
      publicUrl: "https://www.linkedin.com/in/vincent-bouthors-142862",
      firstName: "Vincent",
      lastName: "Bouthors",
    },
  ];
  const [aurelia, vincent] = mergeFullProfiles(candidats, complets);

  assertEquals(aurelia.linkedin_url, "https://www.linkedin.com/in/aurelia-dostert-marketing-com");
  assertEquals(aurelia.last_name, "Dostert");
  assertEquals(aurelia.full_name, "Aurélia Dostert");
  // L'intitule LISIBLE du scan court est conserve : le profil complet renvoie
  // un bandeau vitrine, moins utile a l'ecran et dans un message.
  assertEquals(aurelia.job_title, "Growth Marketing & Communication Manager");
  assertEquals(aurelia.persona_name, "Responsable Communication");
  assertEquals(aurelia.location, "Paris");

  assertEquals(vincent.linkedin_url, "https://www.linkedin.com/in/vincent-bouthors-142862");
  assertEquals(vincent.last_name, "Bouthors");
});

Deno.test("le second etage ne degrade jamais ce qui etait deja bon", () => {
  const deja = [{
    first_name: "Marie", last_name: "Durand", full_name: "Marie Durand",
    job_title: "DRH", linkedin_url: "https://www.linkedin.com/in/marie-durand-rh",
    location: null,
  }];
  // Le fournisseur renvoie un identifiant interne : on ne recule pas.
  const [r] = mergeFullProfiles(deja, [{
    sourceUrl: "https://www.linkedin.com/in/marie-durand-rh",
    publicUrl: "https://www.linkedin.com/in/ACwAAZZZZZZZZZZZZZZZZZZZZZZZZ",
    firstName: "Marie", lastName: "D.",
  }]);
  assertEquals(r.linkedin_url, "https://www.linkedin.com/in/marie-durand-rh");
  assertEquals(r.last_name, "Durand");
});

Deno.test("un candidat sans profil complet correspondant traverse intact", () => {
  const candidats = [{
    first_name: "Paul", last_name: "Martin", full_name: "Paul Martin",
    job_title: "Office Manager", linkedin_url: URN_VINCENT, location: null,
  }];
  assertEquals(mergeFullProfiles(candidats, []), candidats);
  // Un profil pour quelqu'un d'autre ne doit pas contaminer.
  const [intact] = mergeFullProfiles(candidats, [{
    sourceUrl: "https://www.linkedin.com/in/quelquun-dautre",
    publicUrl: "https://www.linkedin.com/in/quelquun-dautre",
    firstName: "Autre", lastName: "Personne",
  }]);
  assertEquals(intact.last_name, "Martin");
  assertEquals(intact.linkedin_url, URN_VINCENT);
});

// ═══════════════════════════════════════════════════════════════════════════
// Second étage — l'appel, et surtout son APPARIEMENT.
//
// Le risque n'est pas de rater un profil : c'est d'en coller un sur la fiche
// de quelqu'un d'autre. Une URL LinkedIn erronée sur une fiche est une erreur
// invisible, et pire qu'une URL manquante.
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("l'identifiant interne est reconnu sous toutes ses formes", () => {
  assertEquals(profileUrnKey(URN_VINCENT), "ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k");
  assertEquals(profileUrnKey("ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k"), "ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k");
  assertEquals(profileUrnKey("urn:li:fsd_profile:ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k"), "ACwAAAAgVEIB31uGmVPvCzo_bfAk0QAtBBznH8k");
  assertEquals(profileUrnKey("https://www.linkedin.com/in/vincent-bouthors-142862"), null);
  assertEquals(profileUrnKey(null), null);
});

// Le fournisseur repond avec un identifiant d'un AUTRE espace que celui
// demande (mesure du 2026-08-21 : « ACoAA… » en reponse a « ACwAA… »).
// L'appariement se fait donc par le NOM — et refuse l'ambiguite.
Deno.test("le second etage apparie par le nom, y compris un patronyme tronque", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        // Ordre inverse de la demande, et identifiant d'un autre espace.
        { id: "ACoAAAUTRESPACE000000000000", publicIdentifier: "aurelia-dostert-marketing-com",
          firstName: "Aurélia", lastName: "Dostert", emails: [] },
        { id: "ACoAAENCOREUNAUTRE0000000000", publicIdentifier: "vincent-bouthors-142862",
          firstName: "Vincent", lastName: "Bouthors" },
      ]),
      { status: 200 },
    );
  try {
    const { profiles, error, diagnostic } = await fetchFullProfiles("clef", [
      { url: URN_AURELIA, firstName: "Aurélia", lastName: "D." },
      { url: URN_VINCENT, firstName: "Vincent", lastName: "Bouthors" },
    ], async () => {});
    assertEquals(error, null);
    assertEquals(diagnostic.apparies, 2);
    const aurelia = profiles.find((p) => p.sourceUrl === URN_AURELIA);
    assertEquals(aurelia?.publicUrl, "https://www.linkedin.com/in/aurelia-dostert-marketing-com");
    assertEquals(aurelia?.lastName, "Dostert");
    const vincent = profiles.find((p) => p.sourceUrl === URN_VINCENT);
    assertEquals(vincent?.publicUrl, "https://www.linkedin.com/in/vincent-bouthors-142862");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("deux homonymes dans la meme demande : on n'apparie NI l'un NI l'autre", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        { publicIdentifier: "marie-dupont-1", firstName: "Marie", lastName: "Dupont" },
        { publicIdentifier: "marie-dupont-2", firstName: "Marie", lastName: "Dupont" },
      ]),
      { status: 200 },
    );
  try {
    const { profiles, diagnostic } = await fetchFullProfiles("clef", [
      { url: "https://www.linkedin.com/in/ACwAAPREMIEREMARIE0000000000", firstName: "Marie", lastName: "Dupont" },
      { url: "https://www.linkedin.com/in/ACwAASECONDEMARIE0000000000", firstName: "Marie", lastName: "Dupont" },
    ], async () => {});
    // Coller l'URL de l'une sur la fiche de l'autre serait invisible et grave.
    assertEquals(profiles.length, 0, "l'ambiguite doit faire renoncer, pas choisir");
    assertEquals(diagnostic.ambigus > 0, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("un profil rendu pour quelqu'un qu'on n'a pas demande est ignore", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        { publicIdentifier: "un-intrus", firstName: "Intrus", lastName: "Indesirable" },
        { publicIdentifier: "sans-prenom", lastName: "Anonyme" },
      ]),
      { status: 200 },
    );
  try {
    const { profiles } = await fetchFullProfiles("clef", [
      { url: URN_VINCENT, firstName: "Vincent", lastName: "Bouthors" },
    ], async () => {});
    assertEquals(profiles.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("un echec du second etage degrade sans casser", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("erreur fournisseur", { status: 500 });
  try {
    const r = await fetchFullProfiles("clef", [
      { url: URN_VINCENT, firstName: "Vincent", lastName: "Bouthors" },
    ], async () => {});
    assertEquals(r.profiles, []);
    assertEquals(typeof r.error, "string");
    const candidats = [{
      first_name: "Vincent", last_name: "Bouthors", full_name: "Vincent Bouthors",
      job_title: "CEO", linkedin_url: URN_VINCENT, location: null,
    }];
    assertEquals(mergeFullProfiles(candidats, r.profiles), candidats);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("aucun appel fournisseur quand il n'y a rien a demander", async () => {
  const originalFetch = globalThis.fetch;
  let appels = 0;
  globalThis.fetch = async () => { appels++; return new Response("[]", { status: 200 }); };
  try {
    const r = await fetchFullProfiles("clef", [], async () => {});
    assertEquals(r.profiles, []);
    assertEquals(appels, 0, "une liste vide ne doit declencher aucune depense");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("le mode du second etage retombe sur le moins cher si inconnu", () => {
  assertEquals(resolveProfileMode(null), "Profile details no email ($4 per 1k)");
  assertEquals(resolveProfileMode("n'importe quoi"), "Profile details no email ($4 per 1k)");
  assertEquals(
    resolveProfileMode("Profile details + email search ($10 per 1k)"),
    "Profile details + email search ($10 per 1k)",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Le logo de l'entreprise, récupéré là où on le payait déjà.
//
// La chaîne logo actuelle interroge quatre sources de FAVICONS — Clearbit (en
// fin de vie), DuckDuckGo, le /favicon.ico du site, Google. Une icône de 16 à
// 64 pixels, ensuite gravée sur un visuel chocolat. Et quand aucun site n'est
// connu, le domaine est deviné depuis le nom légal.
//
// La recherche de société, elle, rend la page LinkedIn de l'entreprise — qui
// porte un vrai logo carré. `companyCandidate` n'en gardait que le nom et
// l'URL ; tout le reste partait à la poubelle.
// ═══════════════════════════════════════════════════════════════════════════
Deno.test("le logo est reconnu sous les formes courantes, imbriquees comprises", () => {
  assertEquals(
    companyLogoUrlFromSearchItem({ logo: "https://media.licdn.com/dms/image/acme.png" }),
    "https://media.licdn.com/dms/image/acme.png",
  );
  assertEquals(
    companyLogoUrlFromSearchItem({ logoUrl: "https://cdn.example.com/l.png" }),
    "https://cdn.example.com/l.png",
  );
  // Certains fournisseurs imbriquent : { logo: { url: ... } }
  assertEquals(
    companyLogoUrlFromSearchItem({ logo: { url: "https://cdn.example.com/nested.png" } }),
    "https://cdn.example.com/nested.png",
  );
  assertEquals(
    companyLogoUrlFromSearchItem({ actor: { profilePicture: "https://cdn.example.com/a.png" } }),
    "https://cdn.example.com/a.png",
  );
});

Deno.test("rien n'est devine : sans logo exploitable, on rend null", () => {
  assertEquals(companyLogoUrlFromSearchItem(null), null);
  assertEquals(companyLogoUrlFromSearchItem({}), null);
  assertEquals(companyLogoUrlFromSearchItem({ logo: "" }), null);
  assertEquals(companyLogoUrlFromSearchItem({ logo: "pas-une-url" }), null);
  // Une donnée en base64 n'est pas une URL téléchargeable ici.
  assertEquals(companyLogoUrlFromSearchItem({ logo: "data:image/png;base64,AAAA" }), null);
});

Deno.test("le logo n'est retenu que sur une resolution CERTAINE", () => {
  const logo = "https://media.licdn.com/dms/image/acme.png";
  // Résolution certaine : on garde.
  const resolu = resolveCompanyCandidate("Acme France", [
    { name: "Acme France", linkedinUrl: "https://www.linkedin.com/company/acme-france", logo },
  ]);
  assertEquals(resolu.status, "resolved");
  assertEquals(resolu.logoUrl, logo);

  // Duel ambigu : apposer le logo d'une homonyme sur un visuel cadeau serait
  // pire que pas de logo du tout.
  const ambigu = resolveCompanyCandidate("Orange", [
    { name: "Orange Business", linkedinUrl: "https://www.linkedin.com/company/orange-business", logo },
    { name: "Orange Bank", linkedinUrl: "https://www.linkedin.com/company/orange-bank", logo },
  ]);
  assertEquals(ambigu.status, "ambiguous");
  assertEquals(ambigu.logoUrl, null);
});

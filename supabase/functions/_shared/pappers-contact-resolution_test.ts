import { extractPappersRepresentatives } from "./pappers-contact-resolution.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("Pappers ne résout que les personnes physiques avec identité complète", () => {
  const result = extractPappersRepresentatives({
    representants: [
      { prenom: "Ada, Augusta", nom: "Lovelace", qualite: "Présidente" },
      { personne_morale: true, denomination: "ACME HOLDING" },
      { prenom: "Prince" },
      { nom_complet: "Madame Grace Hopper", fonction: "Directrice" },
      { prenom: "Ada", nom: "Lovelace", qualite: "Doublon" },
    ],
  });

  assertEquals(result.counts, { resolved: 2, ambiguous: 1, rejected: 2 });
  assertEquals(result.reasonCounts, {
    physical_person_with_complete_legal_name: 2,
    corporate_representative: 1,
    incomplete_identity: 1,
    duplicate_identity: 1,
  });
  assertEquals(result.candidates.map((candidate) => [candidate.first_name, candidate.last_name]), [
    ["Ada", "Lovelace"],
    ["Grace", "Hopper"],
  ]);
  assertEquals(result.candidates.every((candidate) => candidate.resolution_status === "resolved"), true);
});

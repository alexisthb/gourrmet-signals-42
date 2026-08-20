import { chunkValues } from "./pg-chunk.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message ? message + " — " : ""}Expected ${
        JSON.stringify(expected)
      }, received ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("aucun lot ne dépasse la taille demandée", () => {
  const values = Array.from({ length: 1169 }, (_, i) => `id-${i}`);
  const chunks = chunkValues(values, 100);
  assertEquals(chunks.length, 12);
  for (const chunk of chunks) {
    if (chunk.length > 100) {
      throw new Error(`Lot de ${chunk.length} valeurs au-delà de la borne`);
    }
  }
  // Aucune valeur perdue ni dupliquée : un filtre tronqué en silence
  // produirait un résultat partiel pris pour la vérité.
  assertEquals(chunks.flat().length, values.length);
  assertEquals(new Set(chunks.flat()).size, values.length);
  assertEquals(chunks.flat()[0], "id-0");
  assertEquals(chunks.flat()[1168], "id-1168");
});

Deno.test("une liste vide ne produit aucune requête", () => {
  assertEquals(chunkValues([], 100), []);
});

Deno.test("une liste plus courte que la borne tient en un seul lot", () => {
  assertEquals(chunkValues(["a", "b"], 100), [["a", "b"]]);
});

Deno.test("une taille de lot invalide échoue au lieu de deviner", () => {
  for (const size of [0, -1, 1.5]) {
    let thrown = false;
    try {
      chunkValues(["a"], size);
    } catch {
      thrown = true;
    }
    if (!thrown) throw new Error(`chunkSize=${size} aurait dû être refusé`);
  }
});

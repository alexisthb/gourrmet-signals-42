import { detectChocolateTemplate } from "./gift-chocolate.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message ? message + " — " : ""}Expected ${
        JSON.stringify(expected)
      }, received ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Les sept templates RÉELLEMENT présents en production, avec leur orthographe
 * exacte (accents, esperluette, et la coquille « THERMOFORAGE » incluse).
 * Aucun appel fournisseur, aucune image stockée : la classification est une
 * fonction pure.
 */
const PRODUCTION_TEMPLATES: Array<
  { name: string; customPrompt: string | null; chocolate: boolean; why: string }
> = [
  {
    name: "CHAPON MOULES THERMOFORAGE",
    customPrompt: null,
    chocolate: true,
    why: "Chapon est le chocolatier du catalogue",
  },
  {
    name: "CHAPON BAR À MOUSSE & ESQUIMAU",
    customPrompt: null,
    chocolate: true,
    why: "faux négatif historique : « mousse » ne contient pas « moule »",
  },
  {
    name: "PLANTIN COFFRET TRUFFE",
    customPrompt: null,
    chocolate: false,
    why: "faux positif historique : chez Plantin la truffe est un champignon",
  },
  { name: "PLANTIN ANIMATION", customPrompt: null, chocolate: false, why: "" },
  {
    name: "DURANCE BOUGIE",
    customPrompt:
      "This is a luxury Durance candle with a taffeta ribbon/bow. 1. LOGO PLACEMENT (ABOVE THE TAFFETA). 2. COMPANY NAME TEXT (BELOW THE TAFFETA).",
    chocolate: false,
    why: "le prompt libre est inspecté mais ne contient aucun terme chocolat",
  },
  {
    name: "ELY BAR À COCKTAIL AMBULANT",
    customPrompt: null,
    chocolate: false,
    why: "« cocktail » ne doit pas matcher « cocoa »",
  },
  {
    name: "ELY BOUTEILLES ÉTIQUETTES PERSO",
    customPrompt: null,
    chocolate: false,
    why: "",
  },
];

Deno.test("les sept templates de production sont classés correctement", () => {
  for (const template of PRODUCTION_TEMPLATES) {
    const result = detectChocolateTemplate(template.name, template.customPrompt);
    assertEquals(
      result.isChocolate,
      template.chocolate,
      `${template.name}${template.why ? ` (${template.why})` : ""}`,
    );
  }
});

Deno.test("la marque prime et ne dépend plus d une orthographe fragile", () => {
  // La détection tenait au seul pluriel de « MOULES » : ces variantes
  // cassaient silencieusement la règle du blanc sur chocolat.
  for (
    const name of [
      "CHAPON THERMOFORMAGE",
      "CHAPON MOULE THERMOFORMAGE",
      "Chapon — coffret découverte",
      "chapon",
    ]
  ) {
    const result = detectChocolateTemplate(name, null);
    assertEquals(result.isChocolate, true, name);
    assertEquals(result.matchedBy, "brand", name);
  }
});

Deno.test("les termes ambigus ne déclenchent plus le prompt chocolat", () => {
  for (const name of ["PLANTIN COFFRET TRUFFE", "Assortiment praliné", "Truffle box"]) {
    assertEquals(detectChocolateTemplate(name, null).isChocolate, false, name);
  }
});

Deno.test("les mots-clés accentués sont réellement atteignables", () => {
  // Le texte était désaccentué mais pas la liste de mots-clés : tout mot-clé
  // accentué était mort. La normalisation s'applique désormais des deux côtés.
  assertEquals(detectChocolateTemplate("Tablette de CHOCOLÂT", null).isChocolate, true);
  assertEquals(detectChocolateTemplate("Ganaché maison", null).isChocolate, true);
});

Deno.test("le prompt libre de l opératrice peut déclencher le chocolat", () => {
  const result = detectChocolateTemplate(
    "COFFRET SUR MESURE",
    "Marquage sur tablette de chocolat noir",
  );
  assertEquals(result.isChocolate, true);
  assertEquals(result.matchedBy, "keyword");
});

Deno.test("un template inconnu reste sur le prompt standard", () => {
  const result = detectChocolateTemplate("MAISON X COFFRET", null);
  assertEquals(result, {
    isChocolate: false,
    matchedTerm: null,
    matchedBy: null,
  });
});

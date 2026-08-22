import {
  buildColorCheckPrompt,
  buildColorRegenerationFeedback,
  parseColorCheckVerdict,
} from "./chocolate-color-check.ts";

function assertVerdict(
  raw: string,
  expected: "passed" | "failed" | "unreadable",
  expectedElements?: number,
) {
  const v = parseColorCheckVerdict(raw);
  if (v.verdict !== expected) {
    throw new Error(`attendu ${expected}, obtenu ${v.verdict} pour: ${raw.slice(0, 80)}`);
  }
  if (expectedElements !== undefined && v.coloredElements.length !== expectedElements) {
    throw new Error(
      `attendu ${expectedElements} élément(s), obtenu ${v.coloredElements.length}`,
    );
  }
}

Deno.test("un JSON conforme propre passe", () => {
  assertVerdict('{"conforme": true}', "passed", 0);
});

Deno.test("le JSON noye dans du texte ou des clotures de code reste lisible", () => {
  assertVerdict(
    'Voici mon analyse :\n```json\n{"conforme": false, "elements_colores": ["drapeau bleu et rouge sous le monogramme"]}\n```\nVoilà.',
    "failed",
    1,
  );
});

Deno.test("un refus sans detail garde un element generique — jamais une liste vide", () => {
  // Une non-conformité sans description resterait invisible dans les journaux.
  assertVerdict('{"conforme": false}', "failed", 1);
  assertVerdict('{"conforme": false, "elements_colores": []}', "failed", 1);
  assertVerdict('{"conforme": false, "elements_colores": [42, ""]}', "failed", 1);
});

Deno.test("l'illisible n'est JAMAIS un passed par defaut", () => {
  // Une vérification qui échoue en silence rassure à tort — pire que rien.
  assertVerdict("", "unreadable");
  assertVerdict("Je ne peux pas analyser cette image.", "unreadable");
  assertVerdict('{"conforme": "oui"}', "unreadable");
  assertVerdict("{broken json", "unreadable");
});

Deno.test("le prompt de verification nomme les sous-elements et epargne le decor", () => {
  const p = buildColorCheckPrompt();
  for (const fragment of ["drapeaux", "SECONDAIRES", "écrin", "BLANC"]) {
    if (!p.includes(fragment)) throw new Error(`fragment manquant au prompt: ${fragment}`);
  }
});

Deno.test("le feedback de regeneration nomme chaque element fautif", () => {
  const f = buildColorRegenerationFeedback(["drapeau bleu/rouge", "point doré"]);
  for (const fragment of ["- drapeau bleu/rouge", "- point doré", "BLANC PUR", "Ne change rien d'autre"]) {
    if (!f.includes(fragment)) throw new Error(`fragment manquant au feedback: ${fragment}`);
  }
});

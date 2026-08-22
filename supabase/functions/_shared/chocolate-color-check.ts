// LE VÉRIFICATEUR DE LA RÈGLE D'OR CHOCOLAT.
//
// La règle métier est physique, pas esthétique : sur du chocolat, le seul
// colorant alimentaire praticable est le BLANC. Un visuel qui montre un logo
// bleu et rouge sur une tablette promet au prospect un objet impossible à
// fabriquer.
//
// L'histoire de cette règle sur ce projet est une leçon en trois actes :
//   1. la consigne disait « couleurs d'origine » → charrettes et logos
//      multicolores (le refus de Clotilde qui a ouvert la semaine) ;
//   2. la consigne inversée en « blanc uniquement » → le monogramme sortait
//      blanc, mais le drapeau tricolore du logo restait bleu et rouge
//      (constaté au premier test réel, 2026-08-22) ;
//   3. la consigne renforcée nomme les sous-éléments… et reste une consigne.
//
// Un modèle d'image OBÉIT SOUVENT ; une règle métier exige TOUJOURS. D'où ce
// vérificateur : après chaque génération chocolat, un modèle de VISION
// examine l'image et rend un verdict structuré. Non conforme → une
// régénération ciblée qui nomme les éléments fautifs → re-vérification. Le
// verdict final est PERSISTÉ (generated_gifts.color_check) : l'opératrice et
// les mesures savent ce qui est sorti conforme et ce qui ne l'est pas.
//
// Ce module ne contient QUE la partie pure — prompts et parsing — pour être
// éprouvée au banc Deno. Les appels réseau restent dans l'edge function.

export interface ColorCheckVerdict {
  verdict: "passed" | "failed" | "unreadable";
  coloredElements: string[];
}

export function buildColorCheckPrompt(): string {
  return [
    "Tu examines l'image d'un objet en CHOCOLAT portant un marquage de logo.",
    "RÈGLE ABSOLUE : sur le chocolat lui-même, seuls sont autorisés le BLANC",
    "PUR et les teintes naturelles du chocolat (brun foncé, brun lait, ivoire).",
    "Toute autre couleur SUR LE CHOCOLAT est une non-conformité : bleu, rouge,",
    "vert, jaune, or, argent, rose, orange — y compris sur les éléments",
    "SECONDAIRES du marquage (drapeaux, barres, points, symboles, texte).",
    "Le décor HORS chocolat (écrin, ruban, fond, table) peut être coloré :",
    "ne le signale PAS.",
    "",
    "Examine attentivement chaque élément du marquage, un par un.",
    "",
    "Réponds UNIQUEMENT avec un objet JSON, sans texte autour :",
    '{"conforme": true}',
    "ou",
    '{"conforme": false, "elements_colores": ["description précise de chaque',
    'élément coloré vu SUR le chocolat, avec sa couleur"]}',
  ].join("\n");
}

export function buildColorRegenerationFeedback(coloredElements: string[]): string {
  return [
    "Ta précédente image viole la règle d'or : de la COULEUR est apparue sur",
    "le chocolat, sur ces éléments précis :",
    ...coloredElements.map((e) => `- ${e}`),
    "",
    "Régénère l'image en corrigeant UNIQUEMENT cela : chacun de ces éléments",
    "doit être rendu en BLANC PUR, ou omis s'il n'a pas de sens en blanc.",
    "Ne change rien d'autre : même composition, même cadrage, même lumière.",
  ].join("\n");
}

// Le modèle répond parfois avec du texte autour du JSON, des clôtures de code,
// ou un JSON aux types approximatifs. Le parseur est tolérant sur la FORME et
// strict sur le FOND : sans un booléen `conforme` lisible, le verdict est
// « unreadable » — jamais un « passed » par défaut. Une vérification qui
// échoue en silence vaudrait moins que pas de vérification : elle rassure.
export function parseColorCheckVerdict(raw: string): ColorCheckVerdict {
  const text = (raw ?? "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return { verdict: "unreadable", coloredElements: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { verdict: "unreadable", coloredElements: [] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { verdict: "unreadable", coloredElements: [] };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.conforme !== "boolean") {
    return { verdict: "unreadable", coloredElements: [] };
  }
  if (record.conforme) {
    return { verdict: "passed", coloredElements: [] };
  }
  const elements = Array.isArray(record.elements_colores)
    ? record.elements_colores.filter((e): e is string => typeof e === "string" && e.trim() !== "")
    : [];
  return {
    verdict: "failed",
    coloredElements: elements.length > 0 ? elements : ["éléments colorés non détaillés par le vérificateur"],
  };
}

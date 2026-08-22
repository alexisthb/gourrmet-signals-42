// LE FILET SOUS LE GÉNÉRATEUR DE MESSAGES.
//
// La première exécution réelle de generate-message (2026-08-22) a montré ce
// qu'un prompt, même martelé, ne garantit pas : le modèle a écrit
// « n'hésitez pas à revenir vers moi » — formule expressément interdite par
// la charte —, a dépassé le plafond de 80 mots de l'InMail (~89), et a empilé
// deux clôtures avant la question finale. Les six règles structurelles
// (salutation unique, signature unique, pas d'URL inventée, graphie, accords,
// objet court) étaient respectées ; les règles de style, non.
//
// Un prompt est un vœu ; une vérification est une garantie. Ce module relit
// chaque message généré et NOMME les violations. L'edge function tente alors
// UNE régénération ciblée, puis livre la meilleure version avec ses
// avertissements résiduels — Clotilde relit toujours, mais l'outil lui dit
// désormais QUOI regarder au lieu de la laisser deviner.
//
// Fonction PURE, sans dépendance : chaque règle est éprouvée au banc Deno.

export type OutreachMessageType = "email" | "inmail";

export interface MessageReview {
  violations: string[];
}

// Mots avant la signature : le plafond de la charte (80 pour un InMail)
// porte sur le message, pas sur le bloc signature.
export function countWordsBeforeSignature(text: string): number {
  const signatureIndex = text.search(/Clotilde\s+GAUTIER/i);
  const body = signatureIndex >= 0 ? text.slice(0, signatureIndex) : text;
  const words = body.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

// Tolérance : la charte dit 80 mots ; on ne bloque qu'au-delà de 90 pour ne
// pas régénérer en boucle sur une virgule. Entre 80 et 90, c'est à la
// relecture humaine de trancher.
const INMAIL_HARD_WORD_LIMIT = 90;

const CLOSING_PATTERNS: RegExp[] = [
  /je\s+reste\s+à\s+votre\s+(?:entière\s+)?disposition/i,
  /en\s+vous\s+souhaitant\s+une\s+(?:agréable|excellente|belle)/i,
  /dans\s+l['']attente\s+de\s+(?:vous\s+lire|votre\s+retour)/i,
];

export function reviewOutreachMessage(
  type: OutreachMessageType,
  text: string,
): MessageReview {
  const violations: string[] = [];

  // Les pages -recos n'existent pas ; aucune URL fabriquée ne doit passer.
  if (/gourrmet\.com\/[a-z0-9-]+-recos/i.test(text)) {
    violations.push(
      "URL inventée : un lien gourrmet.com/…-recos apparaît — ces pages n'existent pas (404).",
    );
  }

  // La formule commerciale creuse que la charte interdit, sous ses variantes.
  if (/n[''`]h[ée]sitez\s+pas/i.test(text)) {
    violations.push(
      "Formule interdite par la charte : « n'hésitez pas … » — à remplacer par une question directe.",
    );
  }

  const salutations = text.match(/^\s*(Chère Madame|Cher Monsieur|Bonjour\b)/gim) ?? [];
  if (salutations.length === 0) {
    violations.push("Aucune salutation : le message doit ouvrir par « Chère Madame, » ou « Cher Monsieur, ».");
  } else if (salutations.length > 1) {
    violations.push(`Salutations multiples (${salutations.length}) : une seule ouverture autorisée.`);
  }

  const signatures = text.match(/Clotilde\s+GAUTIER/gi) ?? [];
  if (signatures.length === 0) {
    violations.push("Signature absente : le message doit se clore par la signature complète de Clotilde.");
  } else if (signatures.length > 1) {
    violations.push(`Signatures multiples (${signatures.length}) : une seule signature autorisée.`);
  }

  // La marque : GOUЯRMET, Я en quatrième position. « Gourrmet », « Gourmet »
  // (capitale initiale — le domaine gourrmet.com et l'email restent en
  // minuscules et sont légitimes) et « GOURЯMET » (Я déplacé) sont des fautes.
  if (/G(?:OU|ou)R{1,2}(?:MET|met)\b/.test(text) || /\bGourr?met\b/.test(text)) {
    violations.push("Graphie de marque fautive : écrire GOUЯRMET (Я en quatrième position).");
  }
  if (/GOURЯMET/.test(text)) {
    violations.push("Graphie de marque fautive : GOURЯMET a le Я au mauvais endroit — écrire GOUЯRMET.");
  }

  // Une seule clôture avant la question finale : les politesses empilées
  // diluent le message ultra-court voulu par la charte.
  const closings = CLOSING_PATTERNS.filter((p) => p.test(text));
  if (closings.length >= 2) {
    violations.push(
      `Clôtures empilées (${closings.length}) : garder au plus une formule de clôture avant la question finale.`,
    );
  }

  if (type === "inmail") {
    const words = countWordsBeforeSignature(text);
    if (words > INMAIL_HARD_WORD_LIMIT) {
      violations.push(
        `InMail trop long : ${words} mots hors signature, plafond charte 80 (tolérance ${INMAIL_HARD_WORD_LIMIT}).`,
      );
    }
  }

  return { violations };
}

// Le message de reprise envoyé au modèle pour la régénération unique :
// il nomme les violations et interdit de toucher au reste.
export function buildRegenerationFeedback(
  violations: string[],
  previousText: string,
): string {
  return [
    "Ta première version viole ces règles de la charte :",
    ...violations.map((v) => `- ${v}`),
    "",
    "Réécris le message en corrigeant UNIQUEMENT ces points. Conserve le",
    "destinataire, l'événement, les idées proposées, la structure et la",
    "signature. Ne rallonge pas le texte.",
    "",
    "Version à corriger :",
    previousText,
  ].join("\n");
}

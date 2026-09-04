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

// LA CLÔTURE PRESCRITE PAR CLOTILDE POUR LES INMAILS (demande du 04/09).
//
// Elle réunit délibérément DEUX formules que la règle anti-empilement comptait
// jusqu'ici comme une faute — et dont la première était même listée en
// interdit dans la charte. Ce n'est pas l'empilement accidentel du 22/08 :
// c'est la signature d'une professionnelle qui sait comment elle veut clore
// ses messages. Le garde-fou doit donc la RECONNAÎTRE (une clôture, pas deux)
// tout en continuant à refuser une politesse SUPPLÉMENTAIRE par-dessus.
//
// Sans cette exception, la consigne de l'opératrice ferait échouer le contrôle
// sur chacun de ses messages : une régénération facturée à chaque envoi, et un
// avertissement permanent qui apprendrait à Clotilde à ne plus les lire.
const PRESCRIBED_INMAIL_CLOSING =
  /je\s+reste\s+à\s+votre\s+entière\s+disposition\s+pour\s+tout(?:e|es|s)?\s+(?:vos\s+)?questions?\s+suppl[ée]mentaires?\s*[.,]?\s*en\s+vous\s+souhaitant\s+une\s+belle\s+journ[ée]e\s*[.,]?/i;

// Ce que la charte IMPOSE mot pour mot — phrase rituelle, invitation finale,
// clôture de Clotilde — n'est pas de la verbosité du modèle. Compter ces blocs
// dans le plafond de mots reviendrait à sanctionner l'opératrice pour ses
// propres consignes : le plafond mesure ce que le modèle ÉCRIT, pas ce que la
// charte lui DICTE. (Sans cette soustraction, les 21 mots ajoutés le 04/09
// amputaient d'un quart le budget rédactionnel de l'InMail.)
const PRESCRIBED_BLOCKS: RegExp[] = [
  /je\s+fais\s+toujours\s+goûter\s+nos\s+tablettes\s+de\s+chocolat\s*[.!]?/i,
  /si\s+l['']idée\s+vous\s+inspire\s*,?\s*nous\s+pouvons\s+en\s+discuter\s*[.!?]?/i,
  PRESCRIBED_INMAIL_CLOSING,
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

  // Une seule clôture : les politesses empilées diluent le message
  // ultra-court voulu par la charte. La clôture prescrite de Clotilde compte
  // pour UNE — on la retire du texte avant de chercher les autres, sinon ses
  // deux formules se compteraient double et la condamneraient à vie.
  const hasPrescribedClosing = type === "inmail" &&
    PRESCRIBED_INMAIL_CLOSING.test(text);
  const textOutsidePrescribed = hasPrescribedClosing
    ? text.replace(PRESCRIBED_INMAIL_CLOSING, " ")
    : text;
  const closingCount = CLOSING_PATTERNS.filter((p) => p.test(textOutsidePrescribed)).length +
    (hasPrescribedClosing ? 1 : 0);
  if (closingCount >= 2) {
    violations.push(
      `Clôtures empilées (${closingCount}) : garder au plus une formule de clôture avant la signature.`,
    );
  }

  if (type === "inmail") {
    // L'oubli de la clôture de Clotilde est une violation à part entière :
    // c'est une consigne explicite de l'opératrice, pas une préférence.
    if (!hasPrescribedClosing) {
      violations.push(
        "Clôture de Clotilde absente : terminer par « Je reste à votre entière " +
          "disposition pour toutes questions supplémentaires. » puis « En vous " +
          "souhaitant une belle journée, » juste avant la signature.",
      );
    }

    const words = countWordsBeforeSignature(
      PRESCRIBED_BLOCKS.reduce((t, block) => t.replace(block, " "), text),
    );
    if (words > INMAIL_HARD_WORD_LIMIT) {
      violations.push(
        `InMail trop long : ${words} mots rédigés hors signature et hors formules imposées, plafond charte 80 (tolérance ${INMAIL_HARD_WORD_LIMIT}).`,
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

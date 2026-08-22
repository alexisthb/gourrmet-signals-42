import {
  buildRegenerationFeedback,
  countWordsBeforeSignature,
  reviewOutreachMessage,
} from "./message-guardrails.ts";

function assertViolation(violations: string[], fragment: string) {
  if (!violations.some((v) => v.includes(fragment))) {
    throw new Error(
      `violation attendue contenant « ${fragment} », obtenu : ${JSON.stringify(violations)}`,
    );
  }
}

function assertClean(violations: string[]) {
  if (violations.length > 0) {
    throw new Error(`aucune violation attendue, obtenu : ${JSON.stringify(violations)}`);
  }
}

const SIGNATURE = `Clotilde GAUTIER
Chargée d'évènements, GOUЯRMET
📱 +33 7 83 31 94 43
✉️ clotilde@gourrmet.com
🌐 www.gourrmet.com`;

// Le message conforme : celui que la charte décrit. Le domaine en minuscules
// dans la signature ne doit PAS compter comme une faute de graphie.
Deno.test("un message conforme passe sans violation", () => {
  const text = `Chère Madame,

Fêter les 30 ans de votre entreprise est un évènement important.
Chez GOUЯRMET nous avons des idées audacieuses :
- une bougie personnalisée à vos couleurs ?
- un chocolat moulé sur-mesure ?

Je serais ravie d'en discuter avec vous.
L'idée vous inspire ?

${SIGNATURE}`;
  assertClean(reviewOutreachMessage("inmail", text).violations);
  assertClean(reviewOutreachMessage("email", text).violations);
});

// Les trois transgressions observées à la PREMIÈRE exécution réelle
// (2026-08-22) : chacune doit être nommée.
Deno.test("les transgressions du 22/08 sont toutes detectees", () => {
  const text = `Chère Madame,

Chez GOUЯRMET, je serais ravie de vous accompagner.

Si cette idée vous inspire, n'hésitez pas à revenir vers moi.

Je reste à votre entière disposition.

En vous souhaitant une agréable journée.

${SIGNATURE}`;
  const { violations } = reviewOutreachMessage("email", text);
  assertViolation(violations, "n'hésitez pas");
  assertViolation(violations, "Clôtures empilées");
});

Deno.test("une URL -recos inventee est un mur", () => {
  const text = `Chère Madame,

Regardez : www.gourrmet.com/hermes-recos

${SIGNATURE}`;
  assertViolation(reviewOutreachMessage("email", text).violations, "-recos");
});

Deno.test("salutations et signatures doublees sont detectees", () => {
  const doubled = `Bonjour Marie,

Chère Madame,

Contenu.

${SIGNATURE}

${SIGNATURE}`;
  const { violations } = reviewOutreachMessage("email", doubled);
  assertViolation(violations, "Salutations multiples");
  assertViolation(violations, "Signatures multiples");
});

Deno.test("les graphies fautives de la marque sont detectees, le domaine est legitime", () => {
  assertViolation(
    reviewOutreachMessage("email", `Chère Madame,\nChez Gourrmet on aime.\n${SIGNATURE}`).violations,
    "GOUЯRMET",
  );
  assertViolation(
    reviewOutreachMessage("email", `Chère Madame,\nChez GOURMET on aime.\n${SIGNATURE}`).violations,
    "GOUЯRMET",
  );
  // Я déplacé : la graphie du template d'avant correction.
  assertViolation(
    reviewOutreachMessage("email", `Chère Madame,\nChez GOURЯMET on aime.\n${SIGNATURE}`).violations,
    "mauvais endroit",
  );
});

Deno.test("le plafond InMail se mesure hors signature", () => {
  const longBody = Array.from({ length: 95 }, (_, i) => `mot${i}`).join(" ");
  const text = `Chère Madame,\n${longBody}\n${SIGNATURE}`;
  // La signature ne compte pas : le comptage doit refléter le corps seul.
  const words = countWordsBeforeSignature(text);
  if (words < 95 || words > 97) throw new Error(`comptage inattendu : ${words}`);
  assertViolation(reviewOutreachMessage("inmail", text).violations, "InMail trop long");
  // Le même texte en EMAIL (plafond 120, non bloqué ici) ne déclenche pas.
  const emailReview = reviewOutreachMessage("email", text);
  if (emailReview.violations.some((v) => v.includes("InMail"))) {
    throw new Error("le plafond InMail ne concerne pas les emails");
  }
});

Deno.test("le feedback de regeneration nomme chaque violation et porte le texte", () => {
  const feedback = buildRegenerationFeedback(
    ["Violation A", "Violation B"],
    "TEXTE ORIGINAL",
  );
  for (const expected of ["- Violation A", "- Violation B", "TEXTE ORIGINAL", "UNIQUEMENT"]) {
    if (!feedback.includes(expected)) {
      throw new Error(`fragment manquant dans le feedback : ${expected}`);
    }
  }
});

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

// La clôture EXACTE demandée par Clotilde le 04/09 pour ses InMails LinkedIn.
const CLOTURE_LINKEDIN = `Je reste à votre entière disposition pour toutes questions supplémentaires.
En vous souhaitant une belle journée,`;

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
  assertClean(reviewOutreachMessage("email", text).violations);
  // L'InMail, lui, doit désormais porter la clôture de Clotilde.
  assertClean(
    reviewOutreachMessage("inmail", `${text.replace(`\n\n${SIGNATURE}`, "")}
${CLOTURE_LINKEDIN}

${SIGNATURE}`).violations,
  );
});

// LA RÉGRESSION QUI COMPTE. La clôture demandée par Clotilde réunit deux
// formules que la règle anti-empilement comptait séparément : sans exception,
// le contrôle échouerait sur CHACUN de ses messages LinkedIn — une
// régénération facturée par envoi, et un avertissement permanent qui lui
// apprendrait à ne plus les lire.
Deno.test("la cloture prescrite de Clotilde ne compte que pour UNE cloture", () => {
  const text = `Bonjour Madame Lefèvre,

Fêter les 30 ans de votre entreprise est un évènement important.
Chez GOUЯRMET nous avons des idées audacieuses pour vous accompagner.

Je fais toujours goûter nos tablettes de chocolat.
Si l'idée vous inspire, nous pouvons en discuter.
${CLOTURE_LINKEDIN}

${SIGNATURE}`;
  assertClean(reviewOutreachMessage("inmail", text).violations);
});

// L'exception ne désarme pas la règle : une politesse SUPPLÉMENTAIRE
// par-dessus la clôture prescrite reste une faute.
Deno.test("une politesse ajoutee par-dessus la cloture prescrite reste detectee", () => {
  const text = `Bonjour Madame Lefèvre,

Chez GOUЯRMET nous avons des idées audacieuses.

Dans l'attente de vous lire.
${CLOTURE_LINKEDIN}

${SIGNATURE}`;
  assertViolation(reviewOutreachMessage("inmail", text).violations, "Clôtures empilées");
});

// L'oubli de la clôture est une violation : c'est une consigne explicite de
// l'opératrice, pas une préférence de style.
Deno.test("l oubli de la cloture de Clotilde est signale sur un InMail", () => {
  const text = `Bonjour Madame Lefèvre,

Chez GOUЯRMET nous avons des idées audacieuses.
Si l'idée vous inspire, nous pouvons en discuter.

${SIGNATURE}`;
  assertViolation(reviewOutreachMessage("inmail", text).violations, "Clôture de Clotilde absente");
  // L'email n'est pas concerné : la demande de Clotilde portait sur LinkedIn.
  assertClean(reviewOutreachMessage("email", text).violations);
});

// Les 33 mots de formules imposées (rituel + invitation + clôture) ne doivent
// pas dévorer le budget rédactionnel : le plafond mesure ce que le modèle
// écrit, pas ce que la charte lui dicte.
Deno.test("les formules imposees ne consomment pas le plafond de mots", () => {
  const corps = Array.from({ length: 85 }, (_, i) => `mot${i}`).join(" ");
  const text = `Bonjour Madame Lefèvre,
${corps}
Je fais toujours goûter nos tablettes de chocolat.
Si l'idée vous inspire, nous pouvons en discuter.
${CLOTURE_LINKEDIN}

${SIGNATURE}`;
  // Comptage BRUT : au-delà du plafond — c'est ce qui aurait alerté à tort.
  if (countWordsBeforeSignature(text) <= 90) {
    throw new Error("le texte temoin doit depasser 90 mots en comptage brut");
  }
  assertClean(reviewOutreachMessage("inmail", text).violations);

  // Le plafond reste actif sur ce que le modèle rédige VRAIMENT.
  const trop = Array.from({ length: 95 }, (_, i) => `mot${i}`).join(" ");
  assertViolation(
    reviewOutreachMessage("inmail", text.replace(corps, trop)).violations,
    "InMail trop long",
  );
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

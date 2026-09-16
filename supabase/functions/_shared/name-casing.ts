// Les sources (LinkedIn, Dropcontact, Pappers) renvoient souvent les noms de
// famille en CAPITALES. Écrits tels quels dans un message, ils donnent
// « Bonjour Madame RAMON ». On normalise donc la casse avant de composer.

const LOWERCASE_PARTICLES = new Set([
  "de",
  "du",
  "des",
  "da",
  "del",
  "della",
  "di",
  "la",
  "le",
  "van",
  "von",
  "der",
  "den",
  "ter",
  "y",
  "et",
]);


function normalizeWord(word: string, index: number): string {
  const lower = word.toLocaleLowerCase("fr-FR");
  if (index > 0 && LOWERCASE_PARTICLES.has(lower)) return lower;
  // Initiales (« G. ») et sigles courts restent tels quels.
  if (/^[a-zà-ÿ]\.$/.test(lower)) return lower.toLocaleUpperCase("fr-FR");
  // Gère les composés : Jean-Michel, O'Brien, O’Connor, Saint-Éloi.
  return lower.replace(
    /(^|[-'’])([a-zà-ÿ])/g,
    (_match, separator: string, letter: string) =>
      separator + letter.toLocaleUpperCase("fr-FR"),
  );
}

/**
 * Renvoie le nom avec une casse humaine ; laisse intact un nom déjà correct
 * (mixte), ne corrige que les noms tout en capitales ou tout en minuscules.
 */
export function normalizePersonName(
  name: string | null | undefined,
): string {
  const trimmed = (name || "").trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  const hasLower = /[a-zà-ÿ]/.test(trimmed);
  const hasUpper = /[A-ZÀ-Þ]/.test(trimmed);
  const words = trimmed.split(" ");

  // Un nom déjà mixte est respecté mot par mot ; seuls les mots entièrement
  // en capitales (au moins deux lettres) sont recasés. Les composés à trait
  // d'union ou apostrophe comptent aussi : « DUPONT-MOREAU », « O'CONNOR ».
  const SHOUTED_WORD = /^[A-ZÀ-Þ][A-ZÀ-Þ'’\-]*[A-ZÀ-Þ]$/;
  if (hasLower && hasUpper) {
    return words
      .map((word, index) =>
        SHOUTED_WORD.test(word) ? normalizeWord(word, index) : word
      )
      .join(" ");
  }

  return words.map((word, index) => normalizeWord(word, index)).join(" ");
}

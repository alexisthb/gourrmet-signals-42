/**
 * Décide si un visuel cadeau porte sur du CHOCOLAT réel.
 *
 * L'enjeu métier : sur du chocolat, le blanc est le seul colorant physiquement
 * possible. Un template mal classé produit soit un logo aux couleurs de la
 * marque sur du chocolat (impossible à fabriquer, refusé par l'opératrice),
 * soit un logo forcé en blanc sur un produit qui n'est pas du chocolat.
 *
 * La classification précédente ne regardait que des mots génériques et se
 * trompait sur les deux seuls produits chocolat du catalogue :
 *   - « CHAPON BAR À MOUSSE & ESQUIMAU » n'était PAS détecté (« mousse » ne
 *     contient pas « moule »), donc son logo sortait en couleurs sur du
 *     chocolat — exactement le défaut signalé ;
 *   - « PLANTIN COFFRET TRUFFE » était détecté à tort via « truffe », alors que
 *     Plantin vend des truffes-champignons ;
 *   - « CHAPON MOULES THERMOFORAGE » n'était détecté que par le pluriel de
 *     « MOULES » : renommer le template en « CHAPON THERMOFORMAGE » aurait
 *     silencieusement cassé la règle.
 *
 * La marque est donc le signal primaire : chez Gourrmet, Chapon EST le
 * chocolatier. Les mots génériques restent en appoint pour les futurs
 * templates, mais les termes ambigus (truffe, praliné) sont retirés.
 */

/** Marques du catalogue dont les produits sont du chocolat. */
export const CHOCOLATE_BRANDS = ["chapon"] as const;

/**
 * Mots génériques désignant sans ambiguïté du chocolat.
 * `truffe`/`truffle` et `praline`/`praliné` en sont volontairement absents :
 * chez Gourrmet la truffe est un champignon (Plantin), et le praliné apparaît
 * dans des assortiments qui ne sont pas des supports de marquage chocolat.
 */
export const CHOCOLATE_KEYWORDS = [
  "chocolat",
  "chocolate",
  "tablette",
  "bonbon",
  "ganache",
  "cacao",
  "cocoa",
  "moulage",
  "moule",
  "molded",
  "fritsch",
  "pastille",
] as const;

/**
 * Minuscules sans accents. Appliquée AUSSI aux mots-clés : dans la version
 * précédente le texte était désaccentué mais pas la liste, ce qui rendait le
 * mot-clé « praliné » définitivement inatteignable.
 */
export function normalizeForMatch(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface ChocolateDetection {
  isChocolate: boolean;
  /** Terme ayant déclenché la détection, pour les journaux et les tests. */
  matchedTerm: string | null;
  /** `brand` prime sur `keyword` : c'est le signal le plus sûr. */
  matchedBy: "brand" | "keyword" | null;
}

/**
 * Classe un template à partir de son nom et du prompt libre saisi par
 * l'opératrice. Fonction pure : aucun appel réseau, aucune écriture.
 */
export function detectChocolateTemplate(
  templateName: string | null | undefined,
  customPrompt?: string | null,
): ChocolateDetection {
  const haystack = `${normalizeForMatch(templateName)} ${
    normalizeForMatch(customPrompt)
  }`;

  for (const brand of CHOCOLATE_BRANDS) {
    if (haystack.includes(normalizeForMatch(brand))) {
      return { isChocolate: true, matchedTerm: brand, matchedBy: "brand" };
    }
  }

  for (const keyword of CHOCOLATE_KEYWORDS) {
    if (haystack.includes(normalizeForMatch(keyword))) {
      return { isChocolate: true, matchedTerm: keyword, matchedBy: "keyword" };
    }
  }

  return { isChocolate: false, matchedTerm: null, matchedBy: null };
}

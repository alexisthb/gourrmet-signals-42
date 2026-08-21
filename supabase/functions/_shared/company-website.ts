/**
 * Extraction du domaine d'une entreprise depuis le champ `website` ou `domain`
 * de son enrichissement.
 *
 * Ces champs ne contiennent pas toujours UNE adresse. Mesuré en production le
 * 2026-08-21, parmi les signaux de score >= 4 restés sans logo :
 *
 *   "https://www.orange.com / https://www.free.fr / https://www.bouyguestelecom.fr"
 *   "https://www.cardiologiepoledescliniques.fr / https://www.urgencespoledescliniques.fr"
 *
 * `new URL()` échoue sur ces chaînes. L'ancien extracteur rendait alors `null`,
 * et la recherche de logo repartait d'une DEVINETTE sur le nom légal — cinq
 * tentatives brûlées alors que la bonne adresse figurait en première position.
 *
 * On retient la première adresse exploitable : c'est celle de l'entreprise du
 * signal, les suivantes étant des sociétés citées à côté d'elle.
 */
export function firstUsableDomain(value: unknown): string | null {
  const brut = typeof value === "string" ? value.trim() : "";
  if (!brut) return null;

  // La chaîne entière d'abord — le cas normal, une seule adresse.
  const morceaux = [brut, ...brut.split(/\s*[\s,;|]\s*/).map((m) => m.trim()).filter(Boolean)];

  for (const morceau of morceaux) {
    const candidat = morceau.match(/^https?:\/\//i) ? morceau : `https://${morceau}`;
    try {
      const url = new URL(candidat);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      // Un hôte sans point n'est pas un domaine public (`localhost`, un mot
      // isolé qu'on aurait préfixé par erreur).
      if (!host.includes(".")) continue;
      // Un TLD d'au moins deux lettres : écarte « fichier.1 » et consorts.
      if (!/\.[a-z]{2,}$/i.test(host)) continue;
      return host;
    } catch {
      continue;
    }
  }
  return null;
}

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

/**
 * Domaines à essayer pour retrouver le logo d'une entreprise.
 *
 * LE POINT CENTRAL, mesuré le 2026-08-21 : il faut essayer AVEC et SANS `www.`.
 * L'ancien code retirait systématiquement le `www.` d'une adresse pourtant
 * correcte en base. Or beaucoup de sites d'entreprise ne répondent QUE sur le
 * sous-domaine :
 *
 *   ardian.com          -> ne résout pas
 *   www.ardian.com      -> favicon.ico de 15 086 octets, parfaitement valide
 *
 * On avait la bonne adresse et on jetait la partie qui la faisait marcher —
 * puis on brûlait cinq tentatives sur un domaine qui n'existe pas.
 *
 * Les variantes `.fr` et le retrait des qualificatifs (`-group`, `-france`…)
 * sont conservés du code d'origine : ils servent quand le domaine a été deviné
 * depuis le nom légal plutôt que lu en base.
 */
export function buildLogoDomainCandidates(domain: string): string[] {
  const base = (domain || "").trim().toLowerCase().replace(/^www\./, "");
  if (!base) return [];

  const racines = [base];
  if (!base.endsWith(".fr")) racines.push(base.replace(/\.\w+$/, ".fr"));

  const allege = base.replace(/-(group|groupe|france|international|europe|global)\./i, ".");
  if (allege !== base) {
    racines.push(allege);
    if (!allege.endsWith(".fr")) racines.push(allege.replace(/\.\w+$/, ".fr"));
  }

  // Chaque racine est essayée nue PUIS en `www.` : c'est l'ordre qui compte le
  // moins, mais l'absence de la seconde forme qui coûtait des logos entiers.
  const candidats: string[] = [];
  for (const racine of racines) {
    if (!candidats.includes(racine)) candidats.push(racine);
    const avecWww = `www.${racine}`;
    if (!candidats.includes(avecWww)) candidats.push(avecWww);
  }
  return candidats;
}

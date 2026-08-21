/**
 * Une URL de profil LinkedIn peut porter le nom public de la personne
 * (`/in/marie-durand`) ou son identifiant INTERNE (`/in/ACwAAD9yy7YB…`).
 *
 * Le second identifie bien quelqu'un, mais n'ouvre aucune page consultable :
 * pour l'opératrice, c'est un lien mort présenté comme un lien valide.
 *
 * Mesuré le 2026-08-21 : 50 des 108 contacts du stock de travail portaient une
 * telle URL, parce que HarvestAPI ne renvoie pas toujours le nom public en mode
 * de scraping économique. Ces contacts restent utiles — ils ont un nom, une
 * fonction, souvent un email vérifié — mais leur lien LinkedIn ne doit pas être
 * proposé au clic.
 */
export function isOpaqueLinkedInProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const match = url.match(/\/in\/([^/?#]+)/i);
  if (!match) return false;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }
  return /^AC[A-Za-z0-9_-]{18,}$/.test(slug);
}

/** Une URL de profil réellement ouvrable, ou `null`. */
export function usableLinkedInProfileUrl(
  url: string | null | undefined,
): string | null {
  if (!url || isOpaqueLinkedInProfileUrl(url)) return null;
  return url;
}

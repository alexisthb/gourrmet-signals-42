/**
 * Découpe une liste de valeurs destinée à un filtre PostgREST `in.(...)`.
 *
 * Un `.in()` construit son filtre dans l'URL de la requête GET. Une centaine
 * d'UUID pèse déjà quelques kilo-octets ; au-delà, la requête est rejetée ou
 * tronquée par l'infrastructure, et l'appelant reçoit soit une erreur, soit —
 * pire — un résultat partiel qu'il prend pour la vérité. C'est exactement le
 * défaut qui avait vidé la liste Pappers de l'opératrice.
 *
 * 100 valeurs par lot laisse une marge confortable sous toutes les limites
 * usuelles tout en gardant un nombre de requêtes raisonnable.
 */
export function chunkValues<T>(values: readonly T[], chunkSize = 100): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`chunkSize invalide: ${chunkSize}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

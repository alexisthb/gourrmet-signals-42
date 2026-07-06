// Filtre ICP Pappers : ne garder que les vraies sociétés commerciales.
//
// Le scan Pappers remonte aussi des entités SANS décideur d'entreprise à démarcher pour du
// cadeau d'affaires (associations, écoles/établissements publics, collectivités, régies,
// particuliers, sociétés civiles, coopératives agricoles). Elles polluent la liste, donnent
// systématiquement 0 contact à l'enrichissement Manus et gaspillent des crédits.
//
// isIcpLegalForm(forme) : true = société ICP (on garde), false = à exclure.
// Forme inconnue/vide -> GARDÉE (on ne jette pas une vraie société dont la donnée manque).
// Note : mutuelles et sociétés d'assurance mutuelle sont GARDÉES (cibles cadeau d'affaires).

const NON_ICP_PATTERNS = [
  'association',
  'etablissement public',   // inclut "établissement public local d'enseignement" (écoles) + admin
  'communaute',             // communautés d'agglomération / de communes
  'collectivite',
  'regie',                  // régie d'une collectivité
  'entrepreneur individuel',
  'societe civile',         // SCM, SCI...
  'cooperative agricole',
  'syndicat',
];

function normalizeForm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function isIcpLegalForm(formeJuridique?: string | null): boolean {
  if (!formeJuridique) return true; // forme inconnue -> on garde
  const norm = normalizeForm(String(formeJuridique));
  return !NON_ICP_PATTERNS.some((p) => norm.includes(p));
}

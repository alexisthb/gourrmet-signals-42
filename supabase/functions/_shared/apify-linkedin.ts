// Client Apify pour la recherche d'employés opérationnels sur LinkedIn (v2 enrichissement).
//
// Acteur : harvestapi~linkedin-company-employees (no-cookie). VALIDÉ par diagnostic 14/07 :
//   - le filtre par titre CÔTÉ SERVEUR est ignoré par l'acteur -> on ramène maxItems=100
//     employés puis on filtre par regex sur currentPositions[0].title CÔTÉ CLIENT.
//   - taux mesuré : 8 profils opérationnels / 2 entreprises mid-size, 87,5% d'emails vérifiés
//     ensuite via Dropcontact. Coût ~0,004 $/profil ramené (mode "Short").
//
// Modèle ASYNCHRONE : la run Apify prend plusieurs minutes -> on SOUMET (submit) puis on
// POLL via cron (cron-check-linkedin-enrich), comme la voie Manus. Jamais bloquant.

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "harvestapi~linkedin-company-employees";
// Mode le moins cher (~4 $/1000 profils). Valeur d'enum exacte de l'acteur (confirmée au test).
const SCRAPER_MODE = "Short ($4 per 1k)";
const MAX_ITEMS = 100;

// Personas GOURMET = acheteurs de cadeaux d'affaires. On cible les OPÉRATIONNELS (jamais les
// dirigeants légaux). Regex validée au diagnostic (matche Acheteuse, Assistante de direction,
// Purchasing Manager, Office Manager, Resp. Communication/RH/Événementiel, Executive Assistant…).
export const PERSONA_TITLE_RE =
  /office manager|assistant[e]?\s+(?:de\s+)?(?:la\s+)?direction|assistant to|executive assistant|chief of staff|responsable\s+achat|acheteu|purchasing|procurement|responsable\s+communication|communication manager|directrice?\s+communication|responsable\s+[ée]v[ée]nementiel|event manager|responsable\s+services\s+g[ée]n[ée]raux|office & culture|responsable\s+rh|responsable\s+ressources\s+humaines|hr manager|human resources|responsable\s+marketing/i;

export interface LinkedInEmployee {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  location: string | null;
}

// Prénom propre : Pappers/LinkedIn collent parfois des 2e prénoms -> on garde le 1er (avant virgule).
export function firstGivenName(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.split(",")[0].trim();
  return t || null;
}

// Le nom LÉGAL Pappers ("NOKIA NETWORKS FRANCE", "AMAZON DIGITAL FRANCE SAS") matche mal la
// page LinkedIn -> on le normalise avant la recherche d'employés. Prouvé au pilote : nom propre
// (Carambar, Tarkett) = plein de résultats ; nom légal obscur = 0.
const LEGAL_SUFFIX = /\s*\b(sasu|sas|sarl|sa|eurl|snc|sca|scs|se|gie|sci|scop|scm|selarl|sel|scea|scm)\b\.?\s*$/i;
// Qualificatifs qui ne sont JAMAIS une marque en fin de nom.
const GEO_ALWAYS = /\s+(international|holding|group|groupe|europe)\s*$/i;
// "France" PEUT être une marque (AIR FRANCE) -> on ne le retire que s'il reste ≥2 mots avant.
const GEO_FRANCE = /\s+france\s*$/i;

export function normalizeCompanyName(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return raw;
  // Acronyme entre parenthèses en fin ("… (SIC)") = souvent la marque LinkedIn.
  const acr = s.match(/\(\s*([A-Za-z][A-Za-z0-9&.\-]{1,7})\s*\)\s*$/);
  if (acr) return acr[1].trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim(); // retire une parenthèse de fin
  let prev = "";
  while (s !== prev) {
    prev = s;
    const afterLegal = s.replace(LEGAL_SUFFIX, "").trim();
    if (afterLegal !== s && afterLegal.length >= 2) { s = afterLegal; continue; }
    const afterGeo = s.replace(GEO_ALWAYS, "").trim();
    if (afterGeo !== s && afterGeo.length >= 2) { s = afterGeo; continue; }
    if (s.split(/\s+/).length >= 3 && GEO_FRANCE.test(s)) { s = s.replace(GEO_FRANCE, "").trim(); continue; }
  }
  return s.length >= 2 ? s : raw;
}

// Soumet une run Apify (asynchrone). Renvoie runId + datasetId, ou une erreur (jamais throw).
// Résout la page LinkedIn d'une entreprise via harvestapi~linkedin-company-search (schéma validé :
// champ `searchQuery`, ~3-5s). Passer l'URL LinkedIn à company-employees est bien plus précis que
// le nom légal Pappers (qui échoue souvent). Retourne l'URL ou null (fallback nom). Jamais throw.
export async function resolveCompanyLinkedInUrl(apiKey: string, name: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const resp = await fetch(
      `${APIFY_BASE}/acts/harvestapi~linkedin-company-search/run-sync-get-dataset-items?token=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ searchQuery: name, locations: ["France"], maxItems: 3, scraperMode: "short" }),
      },
    );
    if (!resp.ok) return null;
    const items = await resp.json().catch(() => []);
    if (!Array.isArray(items) || items.length === 0) return null;
    const url = items[0]?.linkedinUrl || items[0]?.url || null;
    return typeof url === "string" && url.includes("linkedin.com/company") ? url : null;
  } catch (_e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Soumet une run company-employees (asynchrone). Résout d'abord l'URL LinkedIn (plus précis),
// sinon retombe sur le nom normalisé. Renvoie runId + datasetId, ou une erreur (jamais throw).
export async function submitCompanyEmployeesRun(
  apiKey: string,
  companyNameOrUrl: string,
): Promise<{ runId: string; datasetId: string } | { error: string }> {
  const normalized = normalizeCompanyName(companyNameOrUrl);
  const resolvedUrl = await resolveCompanyLinkedInUrl(apiKey, normalized);
  const companyInput = resolvedUrl || normalized;
  // Timeout dur : si le fetch traîne (egress edge lent/bloqué), on abandonne à 25s pour que
  // l'appelant marque 'failed' (visible) au lieu de rester figé en 'processing' puis tué.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(`${APIFY_BASE}/acts/${ACTOR}/runs?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        companies: [companyInput],
        profileScraperMode: SCRAPER_MODE,
        maxItems: MAX_ITEMS,
        locations: ["France"],
      }),
    });
    const j = await resp.json().catch(() => ({} as any));
    const runId = j?.data?.id;
    const datasetId = j?.data?.defaultDatasetId;
    if (!resp.ok || !runId) {
      return { error: `Apify submit ${resp.status}: ${String(j?.error?.message || j?.error || "no run id").slice(0, 160)}` };
    }
    return { runId, datasetId };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Apify submit timeout (25s)" : e.message) : "Apify submit failed";
    return { error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Vérifie l'état d'une run (un seul GET — le cron rappelle au tick suivant tant que RUNNING).
export async function checkApifyRun(
  apiKey: string,
  runId: string,
): Promise<{ status: string; datasetId: string | null }> {
  try {
    const resp = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`);
    const j = await resp.json().catch(() => ({} as any));
    return { status: j?.data?.status || "UNKNOWN", datasetId: j?.data?.defaultDatasetId || null };
  } catch (_e) {
    return { status: "UNKNOWN", datasetId: null };
  }
}

// Récupère les items du dataset d'une run terminée.
export async function getApifyDataset(apiKey: string, datasetId: string): Promise<any[]> {
  try {
    const resp = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}`);
    if (!resp.ok) return [];
    const items = await resp.json().catch(() => []);
    return Array.isArray(items) ? items : [];
  } catch (_e) {
    return [];
  }
}

// Normalise un profil brut harvestapi -> LinkedInEmployee, en tolérant les variantes de schéma.
export function extractEmployee(p: any): LinkedInEmployee {
  const pos = (Array.isArray(p?.currentPositions) ? p.currentPositions[0] : null) || {};
  const first = firstGivenName(p?.firstName) ||
    firstGivenName((p?.name || "").split(/\s+/)[0]) || null;
  const last = (typeof p?.lastName === "string" && p.lastName.trim())
    ? p.lastName.trim()
    : ((p?.name || "").split(/\s+/).slice(1).join(" ").trim() || null);
  const job_title = (pos?.title || p?.headline || p?.position || p?.jobTitle || null) || null;
  const full_name = [first, last].filter(Boolean).join(" ") || (p?.name || null);
  return {
    first_name: first,
    last_name: last,
    full_name,
    job_title: typeof job_title === "string" ? job_title.trim() : null,
    linkedin_url: p?.linkedinUrl || p?.profileUrl || p?.url || null,
    location: (p?.location && typeof p.location === "object" ? p.location.linkedinText : p?.location) || null,
  };
}

// Filtre "personas GOURMET" + dédoublonnage par URL LinkedIn (ou nom).
export function filterOperationalPersonas(rawItems: any[]): LinkedInEmployee[] {
  const seen = new Set<string>();
  const out: LinkedInEmployee[] = [];
  for (const raw of rawItems) {
    const e = extractEmployee(raw);
    if (!e.job_title || !PERSONA_TITLE_RE.test(e.job_title)) continue;
    if (!e.first_name && !e.last_name) continue;
    const key = (e.linkedin_url || `${e.first_name}|${e.last_name}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

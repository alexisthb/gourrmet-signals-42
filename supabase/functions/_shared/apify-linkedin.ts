// Client Apify pour la recherche d'employés opérationnels sur LinkedIn (v2 enrichissement).
//
// Acteur : harvestapi~linkedin-company-employees (no-cookie). VALIDÉ par diagnostic 14/07 :
//   - le filtre par titre CÔTÉ SERVEUR est ignoré par l'acteur -> on ramène maxItems=100
//     employés puis on filtre par regex sur currentPositions[0].title CÔTÉ CLIENT.
//   - les taux de résolution et d'emails vérifiés sont instrumentés en base ; aucun taux de
//     qualité n'est déduit de ce client sans revue labellisée.
//
// Modèle ASYNCHRONE : la run Apify prend plusieurs minutes -> on SOUMET (submit) puis on
// POLL via cron (cron-check-linkedin-enrich), comme la voie Manus. Jamais bloquant.

const APIFY_BASE = "https://api.apify.com/v2";
const ACTOR = "harvestapi~linkedin-company-employees";
// Mode le moins cher (~4 $/1000 profils). Valeur d'enum exacte de l'acteur (confirmée au test).
const SCRAPER_MODE = "Short ($4 per 1k)";
const MAX_ITEMS = 100;

export type ResolutionStatus = "resolved" | "ambiguous" | "rejected";

export interface Persona {
  name: string;
  isPriority: boolean;
}

export const DEFAULT_PERSONAS: Persona[] = [
  { name: "Assistant(e) de direction", isPriority: true },
  { name: "Office Manager", isPriority: true },
  { name: "Responsable RH", isPriority: false },
  { name: "Directeur General", isPriority: false },
  { name: "DAF / CFO", isPriority: false },
  { name: "Responsable Communication", isPriority: false },
  { name: "Responsable Achats", isPriority: false },
];

export interface LinkedInEmployee {
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  location: string | null;
  persona_name?: string | null;
  persona_priority?: boolean;
  resolution_status?: ResolutionStatus;
  resolution_score?: number;
  resolution_provenance?: Record<string, unknown>;
}

export interface CompanyResolution {
  status: ResolutionStatus;
  score: number;
  linkedinUrl: string | null;
  selectedName: string | null;
  provenance: {
    provider: "apify";
    actor: "harvestapi/linkedin-company-search";
    algorithm: "company-name-evidence-v1";
    query: string;
    reason: string;
    candidates: Array<{
      name: string;
      linkedin_url: string | null;
      score: number;
      evidence: string[];
    }>;
  };
}

export interface ApifyCallUsage {
  operation: "linkedin_company_search" | "linkedin_employee_submit" | "actor_run_poll" | "dataset_items";
  providerRequestId: string | null;
  success: boolean;
  httpStatus: number | null;
  itemsCount: number;
  errorCode: string | null;
}

export type ApifyUsageRecorder = (usage: ApifyCallUsage) => Promise<void>;

async function recordApifyUsage(
  recorder: ApifyUsageRecorder | undefined,
  usage: ApifyCallUsage,
): Promise<string | null> {
  if (!recorder) return null;
  try {
    await recorder(usage);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "usage_persistence_error";
  }
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned || /^(?:undefined|null|none|n\/?a|-)(?:\s+(?:undefined|null|none|n\/?a|-))*$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizedLinkedInUrl(value: unknown, kind: "company" | "profile"): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const expected = kind === "company" ? "/company/" : "/in/";
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return null;
    if (!url.pathname.toLowerCase().includes(expected)) return null;
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Un slug de profil LinkedIn de la forme `ACwAAD9yy7YBveQhMAfTt-4Pdto` est un
 * identifiant INTERNE (URN encode), pas un nom public. L'URL construite avec lui
 * n'ouvre aucun profil consultable : le canal LinkedIn est mort alors que la
 * fiche parait complete.
 *
 * Regression observee en production : apparue en juillet 2026, generalisee
 * ensuite. Au 21 aout, 17 des 75 contacts du stock de travail de l'operatrice
 * portaient une telle URL — dont 100 % des contacts de deux entreprises.
 */
export function isOpaqueLinkedInProfileSlug(slug: string): boolean {
  return /^AC[A-Za-z0-9_-]{18,}$/.test(slug);
}

function profileSlug(url: string): string | null {
  const match = url.match(/\/in\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Choisit la MEILLEURE URL de profil parmi plusieurs candidates.
 *
 * L'acteur HarvestAPI expose a la fois un identifiant public (`publicIdentifier`)
 * et une URL batie sur l'URN. L'ancien code prenait la premiere valeur non vide,
 * donc systematiquement l'URN. On classe desormais : nom public d'abord, URN en
 * dernier recours — jamais rien, plutot que rien du tout.
 */
export function bestLinkedInProfileUrl(candidates: unknown[]): string | null {
  let fallbackOpaque: string | null = null;
  for (const candidate of candidates) {
    const normalized = normalizedLinkedInUrl(candidate, "profile");
    if (!normalized) continue;
    const slug = profileSlug(normalized);
    if (!slug) continue;
    if (!isOpaqueLinkedInProfileSlug(slug)) return normalized;
    if (!fallbackOpaque) fallbackOpaque = normalized;
  }
  return fallbackOpaque;
}

/** Reconstruit une URL de profil depuis un identifiant public nu. */
export function profileUrlFromPublicIdentifier(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  const slug = raw.replace(/^https?:\/\/[^/]*\/in\//i, "").replace(/\/+$/, "");
  if (!slug || slug.includes("/") || isOpaqueLinkedInProfileSlug(slug)) return null;
  return `https://www.linkedin.com/in/${slug}`;
}

export function parsePersonasSetting(value: unknown): Persona[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return DEFAULT_PERSONAS;
    }
  }
  if (!Array.isArray(parsed)) return DEFAULT_PERSONAS;
  const seen = new Set<string>();
  const personas: Persona[] = [];
  for (const item of parsed) {
    const name = cleanString(item?.name);
    if (!name) continue;
    const key = fold(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    personas.push({ name, isPriority: item?.isPriority === true });
    if (personas.length >= 50) break;
  }
  return personas.length ? personas : DEFAULT_PERSONAS;
}

// Prénom propre : Pappers/LinkedIn collent parfois des 2e prénoms -> on garde le 1er (avant virgule).
export function firstGivenName(s: string | null | undefined): string | null {
  const valid = cleanString(s);
  if (!valid) return null;
  const t = valid.split(",")[0].trim();
  return t || null;
}

// Le nom LÉGAL Pappers ("NOKIA NETWORKS FRANCE", "AMAZON DIGITAL FRANCE SAS") matche mal la
// page LinkedIn -> on le normalise avant la recherche d'employés. Prouvé au pilote : nom propre
// (Carambar, Tarkett) = plein de résultats ; nom légal obscur = 0.
const LEGAL_SUFFIX = /\s*\b(sasu|sas|sarl|sa|eurl|snc|sca|scs|se|gie|sci|scop|scm|selarl|sel|scea|scm)\b\.?\s*$/i;
// La forme juridique se met aussi DEVANT le nom — « SAS D'AVAUX », « SARL
// Martin ». Mesuré le 2026-08-21 : seul le suffixe était retiré, et la
// recherche LinkedIn partait avec « SAS D'AVAUX » au lieu de « D'AVAUX ».
// Liste volontairement plus courte que celle des suffixes : « SE » ou « SA »
// en tête d'un nom sont bien plus souvent une marque qu'une forme juridique.
const LEGAL_PREFIX = /^\s*\b(sasu|sas|sarl|eurl|snc|selarl|scop|scea)\b\.?\s+/i;
// Qualificatifs qui ne sont JAMAIS une marque en fin de nom.
const GEO_ALWAYS = /\s+(international|holding|group|groupe|europe)\s*$/i;
// "France" PEUT être une marque (AIR FRANCE) -> on ne le retire que s'il reste ≥2 mots avant.
const GEO_FRANCE = /\s+france\s*$/i;

export function normalizeCompanyName(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return raw;
  // Acronyme entre parenthèses en fin ("… (SIC)") = souvent la marque LinkedIn.
  const acr = s.match(/\(\s*([A-Za-z][A-Za-z0-9&.-]{1,7})\s*\)\s*$/);
  if (acr) return acr[1].trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim(); // retire une parenthèse de fin
  let prev = "";
  while (s !== prev) {
    prev = s;
    const afterLegal = s.replace(LEGAL_SUFFIX, "").trim();
    if (afterLegal !== s && afterLegal.length >= 2) { s = afterLegal; continue; }
    const afterPrefix = s.replace(LEGAL_PREFIX, "").trim();
    if (afterPrefix !== s && afterPrefix.length >= 2) { s = afterPrefix; continue; }
    const afterGeo = s.replace(GEO_ALWAYS, "").trim();
    if (afterGeo !== s && afterGeo.length >= 2) { s = afterGeo; continue; }
    if (s.split(/\s+/).length >= 3 && GEO_FRANCE.test(s)) { s = s.replace(GEO_FRANCE, "").trim(); continue; }
  }
  return s.length >= 2 ? s : raw;
}

function companyCandidate(raw: any): { name: string | null; linkedinUrl: string | null } {
  const actor = raw?.actor && typeof raw.actor === "object" ? raw.actor : {};
  return {
    name: cleanString(raw?.name) || cleanString(raw?.companyName) || cleanString(raw?.title) || cleanString(actor?.name),
    linkedinUrl: normalizedLinkedInUrl(
      raw?.linkedinUrl || raw?.linkedin_url || raw?.companyLinkedinUrl || raw?.url || actor?.linkedinUrl || actor?.url,
      "company",
    ),
  };
}

function scoreCompanyName(query: string, candidate: string): { score: number; evidence: string[] } {
  const q = fold(normalizeCompanyName(query));
  const c = fold(normalizeCompanyName(candidate));
  if (!q || !c) return { score: 0, evidence: ["missing_normalized_name"] };
  if (q === c) return { score: 100, evidence: ["exact_normalized_name"] };

  const qTokens = new Set(q.split(" "));
  const cTokens = new Set(c.split(" "));
  const intersection = [...qTokens].filter((token) => cTokens.has(token)).length;
  const union = new Set([...qTokens, ...cTokens]).size;
  const containment = intersection / Math.min(qTokens.size, cTokens.size);
  const jaccard = union ? intersection / union : 0;
  const score = Math.round(35 * containment + 55 * jaccard);
  const evidence = [
    `token_overlap:${intersection}/${union}`,
    `containment:${containment.toFixed(2)}`,
  ];
  return { score, evidence };
}

// Décision pure et audit-able. Le score mesure la concordance des preuves disponibles ; ce
// n'est pas une précision statistique du modèle. Une égalité ou un résultat moyen reste ambigu.
export function resolveCompanyCandidate(query: string, rawItems: any[]): CompanyResolution {
  const ranked = (Array.isArray(rawItems) ? rawItems : [])
    .map(companyCandidate)
    .filter((candidate): candidate is { name: string; linkedinUrl: string | null } => Boolean(candidate.name))
    .map((candidate) => ({ ...candidate, ...scoreCompanyName(query, candidate.name) }))
    .sort((a, b) => b.score - a.score);
  const usable = ranked.filter((candidate) => candidate.linkedinUrl);
  const top = usable[0] || null;
  const second = usable[1] || null;
  let status: ResolutionStatus = "rejected";
  let reason = ranked.length ? "no_candidate_with_company_url" : "no_candidate";

  if (top) {
    const gap = top.score - (second?.score ?? 0);
    if (top.score >= 85 && gap >= 12) {
      status = "resolved";
      reason = "strong_unique_match";
    } else if (top.score >= 45) {
      status = "ambiguous";
      reason = gap < 12 ? "top_candidates_too_close" : "match_not_strong_enough";
    } else {
      reason = "match_below_threshold";
    }
  }

  return {
    status,
    score: top?.score ?? ranked[0]?.score ?? 0,
    linkedinUrl: status === "resolved" ? top?.linkedinUrl ?? null : null,
    selectedName: status === "resolved" ? top?.name ?? null : null,
    provenance: {
      provider: "apify",
      actor: "harvestapi/linkedin-company-search",
      algorithm: "company-name-evidence-v1",
      query,
      reason,
      candidates: ranked.slice(0, 5).map((candidate) => ({
        name: candidate.name,
        linkedin_url: candidate.linkedinUrl,
        score: candidate.score,
        evidence: candidate.evidence,
      })),
    },
  };
}

/**
 * Entree de la run `company-employees`.
 *
 * AUCUN filtre de titre n'est envoye a l'acteur, et c'est DELIBERE. Le
 * diagnostic du 14/07 (en tete de ce fichier) l'avait deja etabli : on ramene
 * jusqu'a 100 employes et on filtre les personas COTE CLIENT, dans
 * `classifyOperationalPersonas`.
 *
 * Un lot de fiabilisation avait ajoute `jobTitles` et `searchQuery` a cette
 * entree — en contradiction avec ce meme diagnostic, et sans mesure. Effet
 * mesure en production le 2026-08-21, jour de sa mise en service :
 *
 *   avant  (sans filtre serveur) : 6, 9, 22, 23, 47, 51, 74, 97, 100, 100 profils
 *   apres  (avec filtre serveur) : 0, 0, 0, 0, 0, 0, 1, 1, 1, 13 profils
 *
 * L'acteur honore donc bien ces champs, et les libelles de personas francais
 * ("Assistant(e) de direction", "Secretaire General") ne correspondent
 * quasiment jamais aux intitules reels des profils LinkedIn. Le tuyau a
 * contacts se vidait silencieusement : la run reussissait, le dataset etait
 * vide, et l'enrichissement concluait « aucun profil operationnel ».
 *
 * Les personas restent le critere de selection — simplement applique la ou il
 * tolere l'approximation : sur les 100 profils rapatries, avec normalisation
 * et correspondance par termes.
 */
export function buildEmployeeSearchInput(companyUrl: string, _personas: Persona[]) {
  return {
    companies: [companyUrl],
    profileScraperMode: SCRAPER_MODE,
    maxItems: MAX_ITEMS,
    locations: ["France"],
  };
}

// Soumet une run Apify (asynchrone). Renvoie runId + datasetId, ou une erreur (jamais throw).
// Résout la page LinkedIn d'une entreprise via harvestapi~linkedin-company-search (schéma validé :
// champ `searchQuery`, ~3-5s). Passer l'URL LinkedIn à company-employees est bien plus précis que
// le nom légal Pappers (qui échoue souvent). Retourne l'URL ou null (fallback nom). Jamais throw.
export async function resolveCompanyLinkedInUrl(
  apiKey: string,
  name: string,
  recordUsage?: ApifyUsageRecorder,
): Promise<CompanyResolution> {
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
    let jsonParsed = true;
    const items = await resp.json().catch(() => {
      jsonParsed = false;
      return [];
    });
    const parsedItems = Array.isArray(items) ? items : [];
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "linkedin_company_search",
      providerRequestId: null,
      success: resp.ok && jsonParsed && Array.isArray(items),
      httpStatus: resp.status,
      itemsCount: parsedItems.length,
      errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : !Array.isArray(items) ? "invalid_payload" : null,
    });
    if (usageError) {
      const rejected = resolveCompanyCandidate(name, []);
      rejected.provenance.reason = "usage_persistence_error";
      return rejected;
    }
    if (!resp.ok) {
      const rejected = resolveCompanyCandidate(name, []);
      rejected.provenance.reason = `provider_http_${resp.status}`;
      return rejected;
    }
    if (!jsonParsed || !Array.isArray(items)) {
      const rejected = resolveCompanyCandidate(name, []);
      rejected.provenance.reason = !jsonParsed ? "provider_invalid_json" : "provider_invalid_payload";
      return rejected;
    }
    return resolveCompanyCandidate(name, parsedItems);
  } catch (_e) {
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "linkedin_company_search",
      providerRequestId: null,
      success: false,
      httpStatus: null,
      itemsCount: 0,
      errorCode: "network_error",
    });
    const rejected = resolveCompanyCandidate(name, []);
    rejected.provenance.reason = usageError ? "usage_persistence_error" : "provider_network_error";
    return rejected;
  } finally {
    clearTimeout(timer);
  }
}

// Soumet une run company-employees (asynchrone). Résout d'abord l'URL LinkedIn (plus précis),
// sinon retombe sur le nom normalisé. Renvoie runId + datasetId, ou une erreur (jamais throw).
export async function submitCompanyEmployeesRun(
  apiKey: string,
  companyNameOrUrl: string,
  personas: Persona[] = DEFAULT_PERSONAS,
  recordUsage?: ApifyUsageRecorder,
  durableResolution?: CompanyResolution,
): Promise<
  { runId: string; datasetId: string | null; resolution: CompanyResolution; personas: Persona[] }
  | { error: string; resolution: CompanyResolution }
> {
  const normalized = normalizeCompanyName(companyNameOrUrl);
  const resolution = durableResolution ||
    await resolveCompanyLinkedInUrl(apiKey, normalized, recordUsage);
  if (resolution.status !== "resolved" || !resolution.linkedinUrl) {
    return {
      error: `Résolution société ${resolution.status}: ${resolution.provenance.reason}`,
      resolution,
    };
  }
  const configuredPersonas = parsePersonasSetting(personas);
  // Timeout dur : si le fetch traîne (egress edge lent/bloqué), on abandonne à 25s pour que
  // l'appelant marque 'failed' (visible) au lieu de rester figé en 'processing' puis tué.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const resp = await fetch(`${APIFY_BASE}/acts/${ACTOR}/runs?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildEmployeeSearchInput(resolution.linkedinUrl, configuredPersonas)),
    });
    let jsonParsed = true;
    const j = await resp.json().catch(() => {
      jsonParsed = false;
      return {} as any;
    });
    const runId = j?.data?.id;
    const datasetId = j?.data?.defaultDatasetId;
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "linkedin_employee_submit",
      providerRequestId: typeof runId === "string" ? runId : null,
      success: resp.ok && jsonParsed && Boolean(runId),
      httpStatus: resp.status,
      itemsCount: 0,
      errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : !runId ? "missing_run_id" : null,
    });
    if (usageError) return { error: usageError, resolution };
    if (!resp.ok || !runId) {
      return {
        error: `Apify submit ${resp.status}: ${String(j?.error?.message || j?.error || "no run id").slice(0, 160)}`,
        resolution,
      };
    }
    return { runId, datasetId: datasetId || null, resolution, personas: configuredPersonas };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Apify submit timeout (25s)" : e.message) : "Apify submit failed";
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "linkedin_employee_submit",
      providerRequestId: null,
      success: false,
      httpStatus: null,
      itemsCount: 0,
      errorCode: e instanceof Error && e.name === "AbortError" ? "timeout" : "network_error",
    });
    if (usageError) return { error: usageError, resolution };
    return { error: msg, resolution };
  } finally {
    clearTimeout(timer);
  }
}

// Vérifie l'état d'une run (un seul GET — le cron rappelle au tick suivant tant que RUNNING).
export async function checkApifyRun(
  apiKey: string,
  runId: string,
  recordUsage?: ApifyUsageRecorder,
): Promise<{
  status: string;
  datasetId: string | null;
  finishedAt: string | null;
  usageTotalUsd: number | null;
  usageError?: string;
}> {
  try {
    const resp = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`);
    let jsonParsed = true;
    const j = await resp.json().catch(() => {
      jsonParsed = false;
      return {} as any;
    });
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "actor_run_poll",
      providerRequestId: runId,
      success: resp.ok && jsonParsed && Boolean(j?.data?.status),
      httpStatus: resp.status,
      itemsCount: 0,
      errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : !j?.data?.status ? "missing_status" : null,
    });
    if (usageError) {
      return { status: "LEDGER_ERROR", datasetId: null, finishedAt: null, usageTotalUsd: null, usageError };
    }
    const reportedCost = j?.data?.usageTotalUsd;
    return {
      status: j?.data?.status || "UNKNOWN",
      datasetId: j?.data?.defaultDatasetId || null,
      finishedAt: typeof j?.data?.finishedAt === "string" ? j.data.finishedAt : null,
      usageTotalUsd: typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0
        ? reportedCost
        : null,
    };
  } catch (_e) {
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "actor_run_poll",
      providerRequestId: runId,
      success: false,
      httpStatus: null,
      itemsCount: 0,
      errorCode: "network_error",
    });
    return {
      status: usageError ? "LEDGER_ERROR" : "UNKNOWN",
      datasetId: null,
      finishedAt: null,
      usageTotalUsd: null,
      ...(usageError ? { usageError } : {}),
    };
  }
}

// Récupère les items du dataset d'une run terminée.
export async function getApifyDataset(apiKey: string, datasetId: string): Promise<any[]> {
  return (await getApifyDatasetWithUsage(apiKey, datasetId)).items;
}

export async function getApifyDatasetWithUsage(
  apiKey: string,
  datasetId: string,
  recordUsage?: ApifyUsageRecorder,
): Promise<{ items: any[]; usageError?: string; requestSucceeded: boolean }> {
  try {
    const resp = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}`);
    let jsonParsed = true;
    const items = await resp.json().catch(() => {
      jsonParsed = false;
      return [];
    });
    const parsedItems = Array.isArray(items) ? items : [];
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "dataset_items",
      providerRequestId: datasetId,
      success: resp.ok && jsonParsed && Array.isArray(items),
      httpStatus: resp.status,
      itemsCount: parsedItems.length,
      errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : !Array.isArray(items) ? "invalid_payload" : null,
    });
    return {
      items: usageError || !resp.ok ? [] : parsedItems,
      ...(usageError ? { usageError } : {}),
      requestSucceeded: resp.ok && jsonParsed && Array.isArray(items),
    };
  } catch (_e) {
    const usageError = await recordApifyUsage(recordUsage, {
      operation: "dataset_items",
      providerRequestId: datasetId,
      success: false,
      httpStatus: null,
      itemsCount: 0,
      errorCode: "network_error",
    });
    return { items: [], ...(usageError ? { usageError } : {}), requestSucceeded: false };
  }
}

// Normalise un profil brut harvestapi -> LinkedInEmployee, en tolérant les variantes de schéma.
export function extractEmployee(p: any): LinkedInEmployee {
  const actor = p?.actor && typeof p.actor === "object" ? p.actor : {};
  const positions = Array.isArray(p?.currentPositions)
    ? p.currentPositions
    : (Array.isArray(actor?.currentPositions) ? actor.currentPositions : []);
  const pos = positions[0] || {};
  const actorName = cleanString(actor?.name);
  const rootName = cleanString(p?.name) || cleanString(p?.fullName);
  const sourceName = actorName || rootName;
  const nameParts = sourceName?.split(/\s+/).filter(Boolean) || [];
  const first = firstGivenName(p?.firstName) || firstGivenName(actor?.firstName) || firstGivenName(nameParts[0]);
  const last = cleanString(p?.lastName) || cleanString(actor?.lastName) || cleanString(nameParts.slice(1).join(" "));
  const jobTitle = cleanString(actor?.position) || cleanString(pos?.title) || cleanString(p?.headline) ||
    cleanString(p?.position) || cleanString(p?.jobTitle);
  const fullName = cleanString([first, last].filter(Boolean).join(" ")) || sourceName;
  return {
    first_name: first,
    last_name: last,
    full_name: fullName,
    job_title: jobTitle,
    // L'identifiant PUBLIC est prioritaire sur toute URL batie sur l'URN.
    linkedin_url: bestLinkedInProfileUrl([
      profileUrlFromPublicIdentifier(actor?.publicIdentifier),
      profileUrlFromPublicIdentifier(p?.publicIdentifier),
      profileUrlFromPublicIdentifier(actor?.public_identifier),
      profileUrlFromPublicIdentifier(p?.public_identifier),
      profileUrlFromPublicIdentifier(actor?.vanityName),
      profileUrlFromPublicIdentifier(p?.vanityName),
      actor?.linkedinUrl, actor?.profileUrl, actor?.url,
      p?.linkedinUrl, p?.profileUrl, p?.url,
    ]),
    location: cleanString(
      actor?.location && typeof actor.location === "object"
        ? actor.location.linkedinText
        : actor?.location || (p?.location && typeof p.location === "object" ? p.location.linkedinText : p?.location),
    ),
  };
}

/**
 * Un intitulé LinkedIn réel ne ressemble presque jamais au libellé d'un persona.
 * Mesure du 2026-08-21, sur les 492 profils rapatriés pour le stock de lundi :
 * **486 rejetés en `persona_no_match`**, dont deux entreprises à 100 profils
 * rapatriés et zéro retenu. Sur cent salariés français, l'absence totale de
 * responsable RH, d'assistante de direction ou de directeur n'est pas crédible :
 * c'est la correspondance qui échouait, pas le vivier.
 *
 * Trois écarts systématiques, tous fatals avec l'ancienne règle (« tous les
 * mots du persona doivent apparaître, au préfixe près ») :
 *
 *   le féminin  « Directrice Générale »              vs « Directeur Général »
 *   l'acronyme  « Responsable Ressources Humaines »  vs « Responsable RH »
 *   l'anglais   « HR Business Partner », « Head of Marketing »
 *
 * Les alias ci-dessous couvrent l'acronyme et l'anglais ; `termMatches` couvre
 * le féminin et le pluriel sans qu'on ait à les énumérer.
 */
const PERSONA_EXTRA_ALIASES: Record<string, string[]> = {
  "assistant de direction": [
    "executive assistant", "personal assistant", "executive secretary",
    "secretaire de direction", "assistante direction",
  ],
  "office manager": [
    "office management", "workplace manager", "workplace experience",
    "services generaux", "facility manager", "responsable administratif",
  ],
  "responsable communication": [
    "communication", "communications", "chargee de communication",
    "charge de communication", "relations presse", "directeur communication",
  ],
  "responsable rh": [
    "ressources humaines", "human resources", "hr", "hrbp",
    "hr business partner", "drh", "responsable du personnel",
    "talent acquisition", "people operations", "responsable recrutement",
  ],
  "directeur general": [
    "ceo", "chief executive", "managing director", "general manager",
    "president", "presidente", "gerant", "gerante", "directeur de site",
    "directeur usine", "directeur etablissement",
  ],
  "responsable evenementiel": [
    "evenementiel", "event manager", "events manager", "chargee evenements",
    "charge evenements", "event marketing",
  ],
  "directeur marketing": [
    "marketing", "head of marketing", "cmo", "chief marketing",
  ],
  "daf cfo": [
    "directeur administratif et financier", "chief financial", "cfo", "daf",
    "responsable administratif et financier", "directeur financier",
    "responsable financier",
  ],
  "responsable achats": [
    "achats", "purchasing", "procurement", "acheteur", "buyer", "sourcing",
  ],
  "secretaire general": ["general secretary", "secretary general"],
};

/** Longueur du préfixe commun à deux mots déjà normalisés. */
function sharedPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Un mot d'intitulé correspond-il à un terme de persona ? Tolère le féminin et
 * le pluriel — « directrice »/« directeur », « acheteuse »/« acheteur » — que
 * la comparaison par préfixe seule ne rattrape pas, puisque aucun des deux
 * n'est préfixe de l'autre.
 */
function termMatches(word: string, term: string): boolean {
  if (word === term) return true;
  if (term.length >= 5 && word.startsWith(term)) return true;
  if (word.length >= 5 && term.startsWith(word)) return true;
  return sharedPrefixLength(word, term) >= 6;
}

function personaAliases(persona: Persona): string[] {
  const base = persona.name.replace(/\(e\)/gi, "").split(/\s*\/\s*/).map(fold).filter(Boolean);
  const key = fold(persona.name.replace(/\(e\)/gi, ""));
  const extras = PERSONA_EXTRA_ALIASES[key] || [];
  const all = [...base, ...extras.map(fold)].filter(Boolean);
  return [...new Set(all)];
}

function personaMatches(title: string, persona: Persona): boolean {
  const titleWords = fold(title).split(" ").filter(Boolean);
  if (!titleWords.length) return false;
  return personaAliases(persona).some((alias) => {
    const terms = alias.split(" ").filter((term) =>
      (term.length > 2 || ["rh", "hr"].includes(term)) &&
      !["de", "des", "du", "la", "le", "et", "of", "for"].includes(term)
    );
    return terms.length > 0 && terms.every((term) =>
      titleWords.some((word) => termMatches(word, term))
    );
  });
}

export function matchPersonaForTitle(title: string | null, personas: Persona[]): Persona | null {
  if (!title) return null;
  return parsePersonasSetting(personas).find((persona) => personaMatches(title, persona)) || null;
}

export function classifyOperationalPersonas(
  rawItems: any[],
  personas: Persona[] = DEFAULT_PERSONAS,
): {
  resolved: LinkedInEmployee[];
  counts: Record<ResolutionStatus, number>;
  decisions: LinkedInEmployee[];
} {
  const seen = new Set<string>();
  const decisions: LinkedInEmployee[] = [];
  const counts: Record<ResolutionStatus, number> = { resolved: 0, ambiguous: 0, rejected: 0 };
  const configured = parsePersonasSetting(personas);
  for (const raw of rawItems) {
    const e = extractEmployee(raw);
    const persona = e.job_title ? configured.find((candidate) => personaMatches(e.job_title as string, candidate)) : null;
    let status: ResolutionStatus = "rejected";
    let reason = "persona_no_match";
    if (!e.full_name || !e.job_title) {
      reason = "missing_identity_or_position";
    } else if (persona && (!e.first_name || !e.last_name)) {
      status = "ambiguous";
      reason = "incomplete_person_identity";
    } else if (persona && !e.linkedin_url) {
      status = "ambiguous";
      reason = "profile_url_missing";
    } else if (persona) {
      status = "resolved";
      reason = "identity_position_and_profile_url";
    }
    const key = (e.linkedin_url || `${e.first_name}|${e.last_name}|${e.job_title}`).toLowerCase();
    if (seen.has(key)) {
      status = "rejected";
      reason = "duplicate_candidate";
    }
    seen.add(key);
    const decision: LinkedInEmployee = {
      ...e,
      persona_name: persona?.name || null,
      persona_priority: persona?.isPriority === true,
      resolution_status: status,
      resolution_score: status === "resolved" ? 100 : status === "ambiguous" ? 70 : 0,
      resolution_provenance: {
        provider: "apify",
        actor: "harvestapi/linkedin-company-employees",
        algorithm: "contact-evidence-v1",
        reason,
        evidence: {
          has_identity: Boolean(e.full_name),
          has_position: Boolean(e.job_title),
          has_profile_url: Boolean(e.linkedin_url),
          persona: persona?.name || null,
        },
      },
    };
    counts[status]++;
    decisions.push(decision);
  }
  return { resolved: decisions.filter((decision) => decision.resolution_status === "resolved"), counts, decisions };
}

// Compatibilité des appelants historiques : seuls les contacts résolus sortent de ce filtre.
export function filterOperationalPersonas(
  rawItems: any[],
  personas: Persona[] = DEFAULT_PERSONAS,
): LinkedInEmployee[] {
  return classifyOperationalPersonas(rawItems, personas).resolved;
}

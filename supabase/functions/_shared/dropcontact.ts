// Client Dropcontact (https://api.dropcontact.com) — recherche + vérification d'emails B2B
// nominatifs, 100 % RGPD. Remplace l'agent Manus pour la partie "email vérifié".
//
// Modèle ASYNCHRONE côté Dropcontact : POST /v1/enrich/all renvoie un request_id, puis on interroge
// GET /v1/enrich/all/{request_id} jusqu'à success:true. Chaque invocation borne son polling ;
// un lot encore actif est repris par le cron avec le même request_id.
//
// Règle anti-fabrication (GR-002) : Dropcontact ne renvoie que des emails qu'il a qualifiés ;
// on n'insère JAMAIS un email dont la qualification est explicitement négative.

import {
  finalizeProviderUsageDispatch,
  persistProviderUsage,
  type ProviderUsageLedgerClient,
} from "./provider-usage.ts";

// Endpoint v1 documenté par Dropcontact. L'ancien api.dropcontact.io/batch était un alias
// historique non documenté et ne permettait pas de raisonner sur un contrat stable.
const BASE = "https://api.dropcontact.com/v1/enrich";

export interface DropcontactInput {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  website?: string;
  num_siren?: string;
  job?: string;
  linkedin?: string;
  company_linkedin?: string;
  custom_fields?: Record<string, string>;
}

interface DropcontactEmail {
  email?: string;
  qualification?: string;
}

export interface DropcontactResult {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: DropcontactEmail[];
  phone?: string;
  mobile_phone?: string;
  company?: string;
  website?: string;
  job?: string;
  linkedin?: string;
  custom_fields?: Record<string, string>;
}

export interface DropcontactCallUsage {
  operation: "enrich_submit" | "enrich_poll";
  providerRequestId: string | null;
  attempt: number;
  success: boolean;
  httpStatus: number | null;
  itemsCount: number;
  errorCode: string | null;
  creditsLeft: number | null;
}

export type DropcontactUsageRecorder = (usage: DropcontactCallUsage) => Promise<void>;

export interface DropcontactSubmissionLedgerContext {
  supabase: ProviderUsageLedgerClient;
  enrichmentId: string;
  operationGeneration?: string;
  signalId: string;
  metadata?: Record<string, unknown>;
}

export type DropcontactSubmissionResult =
  | { request_id: string }
  | { error: string; ledger_error?: boolean; uncertain?: boolean };

export function dropcontactSubmissionKeys(operationGeneration: string): {
  requestKey: string;
  businessKey: string;
} {
  return {
    requestKey: `enrichment:${operationGeneration}:dropcontact-submit-v1`,
    businessKey: `enrichment:${operationGeneration}:dropcontact-enrich-v1`,
  };
}

// Le contrat v1 annonce un entier JSON `credits_left` sur les réponses POST/GET.
// Les exemples fournisseur ne sont toutefois pas cohérents pour les réponses encore
// en traitement : toute valeur absente, textuelle, négative ou fractionnaire reste NULL.
export function parseDropcontactCreditsLeft(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).credits_left;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function dropcontactBalanceMetadata(usage: DropcontactCallUsage): Record<string, unknown> {
  return {
    credits_left: usage.creditsLeft,
    balance_unit: "credits",
    balance_source: usage.creditsLeft === null ? null : "provider_api",
    provider_reported_field: usage.creditsLeft === null ? null : "credits_left",
    balance_measurement_quality: usage.creditsLeft === null ? "not_observed" : "provider_reported",
  };
}

async function recordDropcontactUsage(
  recorder: DropcontactUsageRecorder | undefined,
  usage: DropcontactCallUsage,
): Promise<string | null> {
  if (!recorder) return null;
  try {
    await recorder(usage);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "usage_persistence_error";
  }
}

function identityPart(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ")
    : "";
}

// Les lots ne sont pas zippés par index : custom_fields est le contrat primaire. Le fallback
// identité ne sert qu'aux lots déjà en vol avant déploiement et n'est accepté que s'il est unique.
export function findDropcontactResult(
  results: DropcontactResult[],
  candidateId: string,
  identity: { first_name?: string | null; last_name?: string | null },
): DropcontactResult | null {
  if (!Array.isArray(results)) return null;
  const byId = results.find((result) => result?.custom_fields?.gourrmet_candidate_id === candidateId);
  if (byId) return byId;
  if (results.some((result) => result?.custom_fields?.gourrmet_candidate_id)) return null;

  const first = identityPart(identity.first_name);
  const last = identityPart(identity.last_name);
  if (!first && !last) return null;
  const matches = results.filter((result) =>
    identityPart(result?.first_name) === first && identityPart(result?.last_name) === last
  );
  return matches.length === 1 ? matches[0] : null;
}

export interface VerifiedDropcontactEmail {
  email: string;
  qualification: string;
  verification_status: "verified";
  provider: "dropcontact";
  // Dropcontact ne renvoie pas de probabilité par adresse dans l'API. Null est volontaire :
  // on conserve la preuve qualitative sans fabriquer un taux de validité local.
  confidence: null;
}

const EXPLICIT_VERIFIED_QUALIFICATION_RE = /^nominati(?:ve|f)@pro$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function dropcontactEmailQualifications(emails: DropcontactEmail[] | undefined): string[] {
  if (!Array.isArray(emails)) return [];
  return [...new Set(emails
    .map((candidate) => typeof candidate?.qualification === "string" ? candidate.qualification.trim() : "")
    .filter(Boolean))];
}

// Choisit le meilleur email vérifié d'un résultat Dropcontact, ou null si aucun exploitable.
export function pickVerifiedEmail(
  emails: DropcontactEmail[] | undefined,
): VerifiedDropcontactEmail | null {
  if (!Array.isArray(emails)) return null;
  const selected = emails.find((candidate) => {
    const email = typeof candidate?.email === "string" ? candidate.email.trim().toLowerCase() : "";
    const qualification = typeof candidate?.qualification === "string" ? candidate.qualification.trim() : "";
    return EMAIL_RE.test(email) && EXPLICIT_VERIFIED_QUALIFICATION_RE.test(qualification);
  });
  if (!selected?.email || !selected.qualification) return null;
  return {
    email: selected.email.trim().toLowerCase(),
    qualification: selected.qualification.trim(),
    verification_status: "verified",
    provider: "dropcontact",
    confidence: null,
  };
}

// Soumet un lot. Renvoie le request_id ou une erreur (jamais throw : l'appelant décide).
export async function submitDropcontactBatch(
  apiKey: string,
  data: DropcontactInput[],
  ledger: DropcontactSubmissionLedgerContext,
): Promise<DropcontactSubmissionResult> {
  const enrichmentId = typeof ledger?.enrichmentId === "string"
    ? ledger.enrichmentId.trim()
    : "";
  const signalId = typeof ledger?.signalId === "string" ? ledger.signalId.trim() : "";
  const operationGeneration = typeof ledger?.operationGeneration === "string" &&
      ledger.operationGeneration.trim()
    ? ledger.operationGeneration.trim()
    : enrichmentId;
  if (!ledger?.supabase || !enrichmentId || !signalId) {
    return {
      error: "ledger Dropcontact: contexte de soumission durable manquant",
      ledger_error: true,
    };
  }
  const { requestKey, businessKey } = dropcontactSubmissionKeys(operationGeneration);
  const intentUsage: DropcontactCallUsage = {
    operation: "enrich_submit",
    providerRequestId: null,
    attempt: 1,
    success: false,
    httpStatus: null,
    itemsCount: 0,
    errorCode: "dispatch_unconfirmed",
    creditsLeft: null,
  };
  const intentMetadata = {
    ...(ledger.metadata || {}),
    operation_generation: operationGeneration,
    ...dropcontactBalanceMetadata(intentUsage),
    provider_request_id: null,
    attempt: 1,
    unit_basis: "not_returned_by_provider",
    measurement_quality: "dispatch_intent",
    business_key: businessKey,
  };
  try {
    // La contrainte unique (provider, request_key) fait de l'insertion la
    // réservation autoritaire. Un doublon ou un ledger indisponible arrête le
    // flux ici, avant le premier octet envoyé à Dropcontact.
    await persistProviderUsage(ledger.supabase, {
      provider: "dropcontact",
      operation: "enrich_submit",
      businessKey,
      requestKey,
      signalId,
      runId: enrichmentId,
      success: false,
      units: 0,
      requestsCount: 0,
      itemsCount: 0,
      errorCode: "dispatch_unconfirmed",
      dispatchStatus: "unconfirmed",
      metadata: intentMetadata,
    });
  } catch (error) {
    return {
      error: `ledger Dropcontact intent: ${error instanceof Error ? error.message : "écriture refusée"}`,
      ledger_error: true,
    };
  }

  try {
    const resp = await fetch(`${BASE}/all`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Access-Token": apiKey },
      body: JSON.stringify({ data, siren: true, language: "fr" }),
    });
    let jsonParsed = true;
    const j = await resp.json().catch(() => {
      jsonParsed = false;
      return {};
    }) as Record<string, unknown>;
    const requestId = typeof j?.request_id === "string" && j.request_id.trim()
      ? j.request_id.trim()
      : null;
    const creditsLeft = parseDropcontactCreditsLeft(j);
    const usage: DropcontactCallUsage = {
      operation: "enrich_submit",
      providerRequestId: requestId,
      attempt: 1,
      success: resp.ok && jsonParsed && Boolean(requestId),
      httpStatus: resp.status,
      itemsCount: data.length,
      errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : !requestId ? "missing_request_id" : null,
      creditsLeft,
    };
    try {
      // Même request_key : aucune deuxième ligne n'est créée après la réponse.
      await finalizeProviderUsageDispatch(ledger.supabase, {
        provider: "dropcontact",
        operation: "enrich_submit",
        businessKey,
        requestKey,
        signalId,
        runId: enrichmentId,
        success: usage.success,
        units: 0,
        requestsCount: 1,
        itemsCount: usage.itemsCount,
        httpStatus: usage.httpStatus,
        errorCode: usage.errorCode,
        dispatchStatus: "confirmed",
        metadata: {
          ...(ledger.metadata || {}),
          operation_generation: operationGeneration,
          ...dropcontactBalanceMetadata(usage),
          provider_request_id: usage.providerRequestId,
          attempt: usage.attempt,
          unit_basis: "not_returned_by_provider",
          measurement_quality: "provider_response",
          business_key: businessKey,
        },
      });
    } catch (error) {
      return {
        error: `ledger Dropcontact finalization: ${error instanceof Error ? error.message : "mise à jour refusée"}`,
        ledger_error: true,
        uncertain: true,
      };
    }
    // Un identifiant fournisseur est une preuve récupérable, même si le code
    // HTTP est atypique : le retry doit repoller ce lot, jamais le recréer.
    if (requestId) return { request_id: requestId };
    return {
      error: `Dropcontact submit ${resp.status}: ${String(j?.reason || j?.error || "no request_id").slice(0, 160)}`,
      uncertain: true,
    };
  } catch (e) {
    // Aucun résultat fournisseur n'est prouvé. L'intention reste unconfirmed ;
    // sa clé stable bloquera toute resoumission jusqu'à réconciliation.
    return {
      error: e instanceof Error ? e.message : "Dropcontact submit failed",
      uncertain: true,
    };
  }
}

// Interroge le lot jusqu'à ce qu'il soit prêt. Dropcontact renvoie success:false tant que le
// traitement n'est pas terminé -> on re-poll. Borné par maxAttempts*delayMs (défaut ~30 s).
export async function pollDropcontactBatch(
  apiKey: string,
  requestId: string,
  opts: { maxAttempts?: number; delayMs?: number } = {},
  recordUsage?: DropcontactUsageRecorder,
): Promise<{ data: DropcontactResult[] } | { error: string; pending?: boolean; ledger_error?: boolean }> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const delayMs = opts.delayMs ?? 5000;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      const resp = await fetch(`${BASE}/all/${requestId}`, { headers: { "X-Access-Token": apiKey } });
      let jsonParsed = true;
      const j = await resp.json().catch(() => {
        jsonParsed = false;
        return {};
      }) as Record<string, unknown>;
      const items = j?.success === true && Array.isArray(j?.data) ? j.data as DropcontactResult[] : [];
      const creditsLeft = parseDropcontactCreditsLeft(j);
      const usageError = await recordDropcontactUsage(recordUsage, {
        operation: "enrich_poll",
        providerRequestId: requestId,
        attempt: i + 1,
        success: resp.ok && jsonParsed,
        httpStatus: resp.status,
        itemsCount: items.length,
        errorCode: !resp.ok ? `http_${resp.status}` : !jsonParsed ? "invalid_json" : null,
        creditsLeft,
      });
      if (usageError) return { error: usageError, ledger_error: true };
      if (j?.success === true && Array.isArray(j?.data)) {
        return { data: items };
      }
      // success:false => encore en traitement, on continue.
    } catch (_e) {
      const usageError = await recordDropcontactUsage(recordUsage, {
        operation: "enrich_poll",
        providerRequestId: requestId,
        attempt: i + 1,
        success: false,
        httpStatus: null,
        itemsCount: 0,
        errorCode: "network_error",
        creditsLeft: null,
      });
      if (usageError) return { error: usageError, ledger_error: true };
      // erreur transitoire réseau -> on retente au tour suivant, après persistance du ledger
    }
  }
  return { error: "Dropcontact: lot pas prêt dans le délai imparti", pending: true };
}

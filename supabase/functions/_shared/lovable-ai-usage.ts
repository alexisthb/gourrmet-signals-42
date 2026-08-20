import {
  finalizeProviderUsageDispatch,
  persistProviderUsage,
  type ProviderUsageInput,
} from "./provider-usage.ts";

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type JsonRecord = Record<string, unknown>;
type LedgerError = { code?: string; message: string } | null;

interface LedgerSelectQuery {
  limit(count: number): PromiseLike<{ error: LedgerError }>;
}

interface LedgerUpdateQuery {
  eq(column: string, value: unknown): LedgerUpdateQuery;
  select(columns: string): {
    maybeSingle(): PromiseLike<{ data: unknown; error: LedgerError }>;
  };
}

interface LovableAILedgerClient {
  from(table: string): {
    insert(
      values: Record<string, unknown>,
    ): PromiseLike<{ error: LedgerError }>;
    select(columns: string): LedgerSelectQuery;
    update(values: Record<string, unknown>): LedgerUpdateQuery;
  };
}

export interface LovableAIRequestInput {
  supabase: LovableAILedgerClient | null;
  apiKey: string;
  operation: string;
  businessKey?: string | null;
  invocationId: string;
  attempt: number;
  model: string;
  body: Record<string, unknown>;
  itemsCount: number;
  itemBasis: string;
  signalId?: string | null;
  contactId?: string | null;
  runId?: string | null;
  metadata?: Record<string, unknown>;
  fetcher?: typeof fetch;
  recordUsage?: (input: ProviderUsageInput) => Promise<void>;
  finalizeUsage?: (input: ProviderUsageInput) => Promise<void>;
  /**
   * Appelé une fois l'intention de dépense durable dans le ledger, et avant
   * tout POST. C'est la seule fenêtre où un appelant peut basculer sa propre
   * machine d'état de « réservé, rejouable » vers « dispatché, ambigu si
   * perdu ». Une exception ici interdit le POST : mieux vaut ne pas appeler que
   * de perdre la trace d'un appel payant.
   */
  onDispatchIntentDurable?: (context: { requestKey: string }) => Promise<void>;
  onResponseObserved?: (response: {
    status: number;
    rawBody: string | null;
    payload: JsonRecord | null;
  }) => Promise<void>;
}

export interface LovableAIRequestResult {
  ok: boolean;
  status: number;
  payload: JsonRecord | null;
  rawBody: string;
  requestKey: string;
}

export interface LovableAITokenUsage {
  totalTokens: number | null;
  fields: Record<string, unknown> | null;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function tokenFieldsOnly(value: unknown): Record<string, unknown> | null {
  if (!isJsonRecord(value)) return null;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const numeric = exactTokenCount(child);
    if (numeric !== null && /token/i.test(key)) {
      result[key] = numeric;
      continue;
    }

    if (isJsonRecord(child)) {
      const nested = tokenFieldsOnly(child);
      if (nested && Object.keys(nested).length > 0) result[key] = nested;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Ne calcule jamais un total absent : seuls les compteurs explicitement
 * renvoyés par la gateway sont conservés comme mesure fournisseur exacte.
 */
export function extractLovableAITokenUsage(
  payload: unknown,
): LovableAITokenUsage {
  if (!isJsonRecord(payload)) return { totalTokens: null, fields: null };

  const usageCandidates = [
    payload.usage,
    payload.usage_metadata,
    payload.usageMetadata,
  ]
    .filter(isJsonRecord);
  const fields: Record<string, unknown> = {};
  let totalTokens: number | null = null;

  for (const usage of usageCandidates) {
    const exactFields = tokenFieldsOnly(usage);
    if (exactFields) Object.assign(fields, exactFields);

    if (totalTokens === null) {
      totalTokens = exactTokenCount(usage.total_tokens) ??
        exactTokenCount(usage.totalTokens) ??
        exactTokenCount(usage.total_token_count) ??
        exactTokenCount(usage.totalTokenCount);
    }
  }

  return {
    totalTokens,
    fields: Object.keys(fields).length > 0 ? fields : null,
  };
}

export function lovableAIRequestKey(
  operation: string,
  invocationId: string,
  attempt: number,
): string {
  const safeOperation = operation.trim().toLowerCase().replace(
    /[^a-z0-9_]+/g,
    "_",
  );
  if (
    !safeOperation || !invocationId || !Number.isInteger(attempt) || attempt < 1
  ) {
    throw new Error("Invalid Lovable AI request key components");
  }
  return `lovable_ai:${safeOperation}:${invocationId}:${attempt}`;
}

export async function lovableAICohortKey(
  namespace: string,
  parts: string[],
): Promise<string> {
  const safeNamespace = namespace.trim().toLowerCase().replace(
    /[^a-z0-9_]+/g,
    "_",
  );
  if (!safeNamespace || parts.length === 0 || parts.some((part) => !part)) {
    throw new Error("Invalid Lovable AI cohort key components");
  }
  const canonical = `${safeNamespace}\n${[...parts].sort().join("\n")}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hex = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${safeNamespace}:${hex}`;
}

export async function assertLovableAILedgerReady(
  supabase: LovableAILedgerClient,
): Promise<void> {
  const { error } = await supabase
    .from("provider_usage_events")
    .select("id")
    .limit(1);
  if (error) throw new Error(`Lovable AI ledger unavailable: ${error.message}`);
}

function parseJsonRecord(rawBody: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(rawBody);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function persistLovableAIUsageWithRetry(
  supabase: LovableAILedgerClient,
  usage: ProviderUsageInput,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await persistProviderUsage(supabase, usage);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  }
  throw lastError;
}

async function finalizeLovableAIUsageWithRetry(
  supabase: LovableAILedgerClient,
  usage: ProviderUsageInput,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await finalizeProviderUsageDispatch(supabase, usage);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  }
  throw lastError;
}

/**
 * L'intention est durable avant le POST. Sans réponse fournisseur, elle reste
 * explicitement non confirmée et ne peut être confondue avec un appel gratuit.
 */
export async function callMeteredLovableAI(
  input: LovableAIRequestInput,
): Promise<LovableAIRequestResult> {
  const requestKey = lovableAIRequestKey(
    input.operation,
    input.invocationId,
    input.attempt,
  );
  const fetcher = input.fetcher ?? fetch;
  const recordUsage = input.recordUsage ??
    ((usage: ProviderUsageInput) => {
      if (!input.supabase) {
        throw new Error("Lovable AI ledger client is required");
      }
      return persistLovableAIUsageWithRetry(input.supabase, usage);
    });
  const finalizeUsage = input.finalizeUsage ?? input.recordUsage ??
    ((usage: ProviderUsageInput) => {
      if (!input.supabase) {
        throw new Error("Lovable AI ledger client is required");
      }
      return finalizeLovableAIUsageWithRetry(input.supabase, usage);
    });

  const baseUsage: Omit<ProviderUsageInput, "success" | "units"> = {
    provider: "lovable_ai",
    operation: input.operation,
    businessKey: input.businessKey ?? `${input.operation}:${input.invocationId}`,
    requestKey,
    signalId: input.signalId,
    contactId: input.contactId,
    runId: input.runId,
    requestsCount: 0,
    itemsCount: input.itemsCount,
    costAmount: null,
    currency: null,
    costSource: null,
    httpStatus: null,
    errorCode: "dispatch_unconfirmed",
    dispatchStatus: "unconfirmed",
    metadata: {
      model: input.model,
      attempt: input.attempt,
      invocation_id: input.invocationId,
      item_basis: input.itemBasis,
      unit_basis: "tokens_pending",
      measurement_quality: "dispatch_intent",
      ...(input.metadata || {}),
    },
  };
  await recordUsage({ ...baseUsage, success: false, units: 0 });
  // L'intention est durable à partir d'ici : l'appelant peut sceller son état
  // avant que le moindre octet ne parte chez le fournisseur.
  await input.onDispatchIntentDurable?.({ requestKey });

  // Si le fetch lève, aucun statut fournisseur n'est disponible : l'intention
  // reste `unconfirmed`, le dispatch demeure ambigu et non valorisé, et une
  // reprise automatique avec la même clé doit échouer. L'exception remonte
  // telle quelle à l'appelant.
  const response: Response = await fetcher(LOVABLE_AI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
  });

  let rawBody: string;
  try {
    rawBody = await response.text();
  } catch (error) {
    await input.onResponseObserved?.({
      status: response.status,
      rawBody: null,
      payload: null,
    });
    await finalizeUsage({
      provider: "lovable_ai",
      operation: input.operation,
      requestKey,
      signalId: input.signalId,
      contactId: input.contactId,
      runId: input.runId,
      success: false,
      units: 0,
      requestsCount: 1,
      itemsCount: input.itemsCount,
      costAmount: null,
      currency: null,
      costSource: null,
      httpStatus: response.status,
      errorCode: "response_body_error",
      dispatchStatus: "confirmed",
      metadata: {
        model: input.model,
        attempt: input.attempt,
        invocation_id: input.invocationId,
        item_basis: input.itemBasis,
        unit_basis: "tokens_not_returned",
        measurement_quality: "provider_attempt_observed",
        ...(input.metadata || {}),
      },
    });
    throw error;
  }
  const payload = parseJsonRecord(rawBody);
  await input.onResponseObserved?.({
    status: response.status,
    rawBody,
    payload,
  });
  const tokenUsage = extractLovableAITokenUsage(payload);
  const responseId = typeof payload?.id === "string" && payload.id.length <= 300
    ? payload.id
    : null;
  const success = response.ok && payload !== null;
  const errorCode = !response.ok
    ? `http_${response.status}`
    : payload === null
    ? "invalid_json"
    : null;

  await finalizeUsage({
    provider: "lovable_ai",
    operation: input.operation,
    requestKey,
    signalId: input.signalId,
    contactId: input.contactId,
    runId: input.runId,
    success,
    units: tokenUsage.totalTokens ?? 0,
    requestsCount: 1,
    itemsCount: input.itemsCount,
    costAmount: null,
    currency: null,
    costSource: null,
    httpStatus: response.status,
    errorCode,
    dispatchStatus: "confirmed",
    metadata: {
      model: input.model,
      attempt: input.attempt,
      invocation_id: input.invocationId,
      item_basis: input.itemBasis,
      unit_basis: tokenUsage.totalTokens === null
        ? "tokens_not_returned"
        : "total_tokens",
      token_usage: tokenUsage.fields,
      provider_response_id: responseId,
      measurement_quality: "provider_attempt_observed",
      ...(input.metadata || {}),
    },
  });

  return {
    ok: response.ok,
    status: response.status,
    payload,
    rawBody,
    requestKey,
  };
}

export interface LovableAICachedFinalizationInput {
  supabase: LovableAILedgerClient;
  operation: string;
  requestKey: string;
  model: string;
  attempt: number;
  invocationId: string;
  itemsCount: number;
  itemBasis: string;
  status: number;
  payload: JsonRecord | null;
  signalId?: string | null;
  contactId?: string | null;
  runId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Finalise le ledger depuis une réponse DÉJÀ observée et mise en cache, sans
 * jamais relancer d'appel payant. Sert aux reprises : le POST a eu lieu lors
 * d'une invocation précédente qui est morte avant de confirmer sa dépense.
 *
 * Ne lève pas : une intention déjà confirmée par la tentative précédente est le
 * cas nominal d'une reprise, et une finalisation impossible ne doit pas être
 * transformée ici en succès. L'autorité reste le contrôle `dispatch_status =
 * 'confirmed'` fait en SQL au moment d'appliquer la charte.
 */
export async function finalizeLovableAIFromCachedResponse(
  input: LovableAICachedFinalizationInput,
): Promise<{ finalized: boolean; error: string | null }> {
  const tokenUsage = extractLovableAITokenUsage(input.payload);
  const responseId =
    typeof input.payload?.id === "string" && input.payload.id.length <= 300
      ? input.payload.id
      : null;
  const httpOk = input.status >= 200 && input.status < 300;
  try {
    await finalizeLovableAIUsageWithRetry(input.supabase, {
      provider: "lovable_ai",
      operation: input.operation,
      requestKey: input.requestKey,
      signalId: input.signalId,
      contactId: input.contactId,
      runId: input.runId,
      success: httpOk && input.payload !== null,
      units: tokenUsage.totalTokens ?? 0,
      requestsCount: 1,
      itemsCount: input.itemsCount,
      costAmount: null,
      currency: null,
      costSource: null,
      httpStatus: input.status,
      errorCode: !httpOk
        ? `http_${input.status}`
        : input.payload === null
        ? "invalid_json"
        : null,
      dispatchStatus: "confirmed",
      metadata: {
        model: input.model,
        attempt: input.attempt,
        invocation_id: input.invocationId,
        item_basis: input.itemBasis,
        unit_basis: tokenUsage.totalTokens === null
          ? "tokens_not_returned"
          : "total_tokens",
        token_usage: tokenUsage.fields,
        provider_response_id: responseId,
        measurement_quality: "provider_attempt_observed_from_cache",
        ...(input.metadata || {}),
      },
    });
    return { finalized: true, error: null };
  } catch (error) {
    return {
      finalized: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function markLovableAIAttemptFailed(
  supabase: LovableAILedgerClient,
  requestKey: string,
  errorCode: string,
): Promise<void> {
  let lastMessage = "event not found";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await supabase
      .from("provider_usage_events")
      .update({ success: false, error_code: errorCode })
      .eq("provider", "lovable_ai")
      .eq("request_key", requestKey)
      .select("id")
      .maybeSingle();
    if (!error && data) return;
    lastMessage = error?.message || "event not found";
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 25));
    }
  }
  throw new Error(`Lovable AI ledger finalization failed: ${lastMessage}`);
}

export interface CreditPlan {
  monthly_credits?: number | string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
}

export interface CreditBudgetDecision {
  allowed: boolean;
  reason: "ok" | "plan_missing" | "plan_zero" | "period_not_current" | "plan_exhausted" | "usage_invalid";
  limit: number;
  used: number;
  remaining_before: number;
  remaining_after: number;
}

export interface EnrichmentInvocationDisposition {
  kind: "completed" | "running" | "retry";
  reason: string | null;
  externalTaskId: string | null;
}

export interface EnrichmentDispatchIdentity {
  enrichmentId: string;
  operationGeneration: string;
  alreadyCompleted: boolean;
  generationStarted: boolean;
  rawData: Record<string, unknown>;
}

export type ProviderTaskRecoveryDecision =
  | {
    kind: "submit";
    taskId: null;
    reason: "no_prior_task";
  }
  | {
    kind: "reuse";
    taskId: string;
    reason: "local" | "ledger" | "local_and_ledger";
  }
  | {
    kind: "blocked";
    taskId: null;
    reason:
      | "retry_without_provider_proof"
      | "ledger_task_id_missing"
      | "multiple_provider_tasks"
      | "conflicting_task_ids";
  };

export type WaterfallProviderRecoveryDecision =
  | {
    kind: "start_pappers";
    taskId: null;
    reason: "no_durable_waterfall_stage" | "durable_pappers_stage";
  }
  | { kind: "submit_dropcontact"; taskId: null; reason: "durable_candidates_ready" }
  | {
    kind: "poll_dropcontact";
    taskId: string;
    reason: "local" | "ledger" | "local_and_ledger";
  }
  | {
    kind: "blocked";
    taskId: null;
    reason:
      | "provider_proof_without_candidates"
      | "invalid_durable_waterfall_stage"
      | ProviderTaskRecoveryDecision["reason"];
  };

export type ProviderDatasetReadDecision =
  | { kind: "fetch_dataset"; datasetId: string; reason: "first_read" | "replay_same_dataset" }
  | {
    kind: "blocked";
    datasetId: null;
    reason: "dataset_id_missing" | ProviderTaskRecoveryDecision["reason"];
  };

export interface PappersCompanyResponseCache {
  request_key: string;
  usage_id: string;
  success: boolean;
  http_status: number | null;
  error_code: string | null;
  payload: unknown;
}

type PappersReservationStatus = "reserved" | "completed" | "uncertain";

export type PappersCompanyRecoveryDecision =
  | {
    kind: "reserve_and_call";
    usageId: null;
    reservationStatus: null;
    cachedResponse: null;
    reason: "no_prior_operation" | "durable_intent_without_reservation";
  }
  | {
    kind: "reuse_cached_response";
    usageId: string;
    reservationStatus: PappersReservationStatus;
    cachedResponse: PappersCompanyResponseCache;
    reason: "matching_cached_response";
  }
  | {
    kind: "blocked";
    usageId: string | null;
    reservationStatus: PappersReservationStatus | null;
    cachedResponse: null;
    reason:
      | "invalid_durable_intent"
      | "multiple_reservations"
      | "conflicting_request_keys"
      | "conflicting_usage_ids"
      | "invalid_reservation_status"
      | "invalid_reservation_completion"
      | "invalid_cached_response"
      | "cache_without_reservation"
      | "provider_outcome_uncertain";
  };

export type ApifyActorOperation =
  | "linkedin_company_search"
  | "linkedin_employee_submit";

export type ApifyActorRunRecoveryDecision =
  | {
    kind: "reserve";
    reservationId: null;
    providerTaskId: null;
    reason: "no_prior_operation" | "durable_intent_without_reservation";
  }
  | {
    kind: "dispatch";
    reservationId: string;
    providerTaskId: null;
    reason: "prepared_reservation";
  }
  | {
    kind: "finalize_and_reuse";
    reservationId: string;
    providerTaskId: string | null;
    reason: "durable_provider_proof";
  }
  | {
    kind: "reuse";
    reservationId: string;
    providerTaskId: string | null;
    reason: "completed_reservation";
  }
  | {
    kind: "reuse_legacy";
    reservationId: null;
    providerTaskId: string | null;
    reason: "legacy_provider_proof";
  }
  | {
    kind: "blocked";
    reservationId: string | null;
    providerTaskId: string | null;
    reason:
      | "multiple_reservations"
      | "conflicting_request_keys"
      | "conflicting_reservation_ids"
      | "invalid_reservation"
      | "reservation_missing_for_durable_state"
      | "provider_proof_before_dispatch"
      | "provider_outcome_uncertain"
      | "terminal_reservation_without_proof"
      | "expired_reservation"
      | ProviderTaskRecoveryDecision["reason"];
  };

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// `operation_generation` est l'identité durable du job, pas celle de la ligne
// company_enrichment (réutilisée entre deux essais explicites). Sans cette
// preuve renvoyée par la transaction SQL, aucun appel fournisseur ne démarre.
export function parseEnrichmentDispatchIdentity(
  value: unknown,
): EnrichmentDispatchIdentity | null {
  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
  const enrichmentId = nonEmptyString(row?.enrichment_id);
  const operationGeneration = nonEmptyString(row?.operation_generation);
  if (row?.accepted !== true || !enrichmentId || !operationGeneration) return null;
  return {
    enrichmentId,
    operationGeneration,
    alreadyCompleted: row.already_completed === true,
    generationStarted: row.generation_started === true,
    rawData: row.raw_data && typeof row.raw_data === "object"
      ? row.raw_data as Record<string, unknown>
      : {},
  };
}

export function operationGenerationFromRawData(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  return nonEmptyString((value as Record<string, unknown>).operation_generation);
}

export function parseEnrichmentProviderRoute(
  value: unknown,
): "linkedin" | "waterfall" | null {
  return value === "linkedin" || value === "waterfall" ? value : null;
}

export function enrichmentBusinessOperationKey(
  operationGeneration: string,
  workflow: string,
): string {
  return `enrichment:${operationGeneration}:${workflow}`;
}

export function enrichmentProviderAttemptKey(
  enrichmentId: string,
  provider: string,
  operation: string,
  attemptId: string,
): string {
  return `enrichment:${enrichmentId}:${provider}:${operation}:${attemptId}`;
}

// L'endpoint /entreprise n'accepte aucune clé d'idempotence fournisseur. La
// seule clé sûre est donc l'opération métier elle-même, stable sur tous les
// reclaims du même enrichissement.
export function pappersCompanyOperationKey(operationGeneration: string): string {
  return `enrichment:${operationGeneration}:pappers:entreprise-v1`;
}

export function apifyActorOperationKey(
  operationGeneration: string,
  operation: ApifyActorOperation,
): string {
  return `enrichment:${operationGeneration}:apify:${operation}-v1`;
}

// Les endpoints Actor ne fournissent pas de clé d'idempotence. Une réservation
// seulement préparée peut être dispatchée ; dès qu'elle est marquée dispatched,
// il faut une réponse cachée ou un runId fournisseur pour continuer. Sans cette
// preuve, un retry reste bloqué au lieu de payer une seconde run.
export function decideApifyActorRunRecovery(input: {
  requestKey: string;
  localRequestKey: unknown;
  localReservationId: unknown;
  localStage: unknown;
  localProviderTaskId: unknown;
  hasCachedResult: boolean;
  reservationRows: unknown;
  providerLedgerRows: unknown;
  allowLegacyProviderProof: boolean;
}): ApifyActorRunRecoveryDecision {
  const requestKey = nonEmptyString(input.requestKey);
  const localRequestKey = nonEmptyString(input.localRequestKey);
  const localReservationId = nonEmptyString(input.localReservationId);
  const localStage = nonEmptyString(input.localStage);
  const reservationRows = Array.isArray(input.reservationRows)
    ? input.reservationRows
    : input.reservationRows && typeof input.reservationRows === "object"
    ? [input.reservationRows]
    : [];
  const ledgerRows = Array.isArray(input.providerLedgerRows)
    ? input.providerLedgerRows
    : input.providerLedgerRows && typeof input.providerLedgerRows === "object"
    ? [input.providerLedgerRows]
    : [];

  let providerTaskId = nonEmptyString(input.localProviderTaskId);
  if (providerTaskId || ledgerRows.length > 0) {
    const providerRecovery = decideProviderTaskRecovery({
      localTaskId: providerTaskId,
      priorLedgerRows: ledgerRows,
      isRetry: true,
    });
    if (providerRecovery.kind === "blocked") {
      const singleLedgerWithoutTaskId = ledgerRows.length === 1 && (() => {
        const row = ledgerRows[0] && typeof ledgerRows[0] === "object"
          ? ledgerRows[0] as Record<string, unknown>
          : {};
        const metadata = row.metadata && typeof row.metadata === "object"
          ? row.metadata as Record<string, unknown>
          : {};
        return !nonEmptyString(metadata.provider_request_id);
      })();
      // Une réponse terminale cachée (par exemple un refus HTTP sans runId)
      // est une preuve suffisante pour finaliser la réservation. Elle ne rend
      // pas l'appel rejouable ; plusieurs ledgers ou un ID divergent restent
      // ambigus et bloqués.
      if (
        providerRecovery.reason === "ledger_task_id_missing" &&
        input.hasCachedResult &&
        !providerTaskId &&
        singleLedgerWithoutTaskId
      ) {
        providerTaskId = null;
      } else {
        return {
          kind: "blocked",
          reservationId: localReservationId,
          providerTaskId: null,
          reason: providerRecovery.reason,
        };
      }
    }
    if (providerRecovery.kind === "reuse") providerTaskId = providerRecovery.taskId;
  }

  if (!requestKey || (localRequestKey && localRequestKey !== requestKey)) {
    return {
      kind: "blocked",
      reservationId: localReservationId,
      providerTaskId,
      reason: "conflicting_request_keys",
    };
  }
  if (reservationRows.length > 1) {
    return {
      kind: "blocked",
      reservationId: localReservationId,
      providerTaskId,
      reason: "multiple_reservations",
    };
  }

  const reservation = reservationRows[0] && typeof reservationRows[0] === "object"
    ? reservationRows[0] as Record<string, unknown>
    : null;
  const reservationId = nonEmptyString(reservation?.id);
  const reservationKey = nonEmptyString(reservation?.request_key);
  const reservationStatus = nonEmptyString(reservation?.status);
  const metadata = reservation?.metadata && typeof reservation.metadata === "object"
    ? reservation.metadata as Record<string, unknown>
    : {};
  const dispatchState = nonEmptyString(metadata.dispatch_state);
  if (reservation && (!reservationId || reservationKey !== requestKey)) {
    return {
      kind: "blocked",
      reservationId: reservationId || localReservationId,
      providerTaskId,
      reason: "conflicting_request_keys",
    };
  }
  if (localReservationId && reservationId && localReservationId !== reservationId) {
    return {
      kind: "blocked",
      reservationId,
      providerTaskId,
      reason: "conflicting_reservation_ids",
    };
  }

  const durableProof = input.hasCachedResult || Boolean(providerTaskId);
  if (!reservationId) {
    if (durableProof && input.allowLegacyProviderProof && !localReservationId) {
      return {
        kind: "reuse_legacy",
        reservationId: null,
        providerTaskId,
        reason: "legacy_provider_proof",
      };
    }
    if (
      !durableProof && !localReservationId &&
      (!localStage || localStage === "intent")
    ) {
      return {
        kind: "reserve",
        reservationId: null,
        providerTaskId: null,
        reason: localStage === "intent"
          ? "durable_intent_without_reservation"
          : "no_prior_operation",
      };
    }
    return {
      kind: "blocked",
      reservationId: localReservationId,
      providerTaskId,
      reason: "reservation_missing_for_durable_state",
    };
  }

  if (!["reserved", "completed", "failed", "expired"].includes(reservationStatus || "")) {
    return {
      kind: "blocked",
      reservationId,
      providerTaskId,
      reason: "invalid_reservation",
    };
  }
  if (reservationStatus === "expired") {
    return {
      kind: "blocked",
      reservationId,
      providerTaskId,
      reason: "expired_reservation",
    };
  }
  if (reservationStatus === "completed" || reservationStatus === "failed") {
    if (!durableProof) {
      return {
        kind: "blocked",
        reservationId,
        providerTaskId,
        reason: "terminal_reservation_without_proof",
      };
    }
    return {
      kind: "reuse",
      reservationId,
      providerTaskId,
      reason: "completed_reservation",
    };
  }
  if (dispatchState === "prepared") {
    if (durableProof) {
      return {
        kind: "blocked",
        reservationId,
        providerTaskId,
        reason: "provider_proof_before_dispatch",
      };
    }
    return {
      kind: "dispatch",
      reservationId,
      providerTaskId: null,
      reason: "prepared_reservation",
    };
  }
  if (dispatchState === "dispatched") {
    if (!durableProof) {
      return {
        kind: "blocked",
        reservationId,
        providerTaskId,
        reason: "provider_outcome_uncertain",
      };
    }
    return {
      kind: "finalize_and_reuse",
      reservationId,
      providerTaskId,
      reason: "durable_provider_proof",
    };
  }
  return {
    kind: "blocked",
    reservationId,
    providerTaskId,
    reason: "invalid_reservation",
  };
}

function pappersReservationStatus(value: unknown): PappersReservationStatus | null {
  return value === "reserved" || value === "completed" || value === "uncertain"
    ? value
    : null;
}

// Une réservation Pappers sans réponse durable peut déjà avoir été facturée :
// elle ne doit jamais conduire à un second GET /entreprise. À l'inverse, une
// intention persistée avant la réservation est rejouable avec la même clé car
// l'absence autoritaire de ligne prouve que l'appel fournisseur n'a pas débuté.
export function decidePappersCompanyRecovery(input: {
  requestKey: string;
  rawData: unknown;
  reservationRows: unknown;
}): PappersCompanyRecoveryDecision {
  const requestKey = nonEmptyString(input.requestKey);
  const raw = input.rawData && typeof input.rawData === "object"
    ? input.rawData as Record<string, unknown>
    : {};
  const rows = Array.isArray(input.reservationRows)
    ? input.reservationRows
    : input.reservationRows && typeof input.reservationRows === "object"
    ? [input.reservationRows]
    : [];
  const stage = nonEmptyString(raw.waterfall_stage);
  const localRequestKey = nonEmptyString(raw.pappers_request_key);
  const localUsageId = nonEmptyString(raw.pappers_usage_id);
  const pappersStages = [
    "pappers_intent",
    "pappers_calling",
    "pappers_response_cached",
  ];
  const hasPappersState = pappersStages.includes(stage || "") ||
    Boolean(localRequestKey || localUsageId || raw.pappers_response_cache);

  if (!requestKey || (localRequestKey && localRequestKey !== requestKey)) {
    return {
      kind: "blocked",
      usageId: localUsageId,
      reservationStatus: null,
      cachedResponse: null,
      reason: "conflicting_request_keys",
    };
  }
  if (rows.length > 1) {
    return {
      kind: "blocked",
      usageId: localUsageId,
      reservationStatus: null,
      cachedResponse: null,
      reason: "multiple_reservations",
    };
  }

  const reservation = rows[0] && typeof rows[0] === "object"
    ? rows[0] as Record<string, unknown>
    : null;
  const reservationId = nonEmptyString(reservation?.id);
  const reservationKey = nonEmptyString(reservation?.request_key);
  const reservationStatus = pappersReservationStatus(reservation?.reservation_status);
  const reservationSuccess = typeof reservation?.success === "boolean"
    ? reservation.success
    : null;
  if (reservation && (!reservationId || reservationKey !== requestKey)) {
    return {
      kind: "blocked",
      usageId: reservationId || localUsageId,
      reservationStatus,
      cachedResponse: null,
      reason: "conflicting_request_keys",
    };
  }
  if (reservation && !reservationStatus) {
    return {
      kind: "blocked",
      usageId: reservationId,
      reservationStatus: null,
      cachedResponse: null,
      reason: "invalid_reservation_status",
    };
  }
  if (localUsageId && reservationId && localUsageId !== reservationId) {
    return {
      kind: "blocked",
      usageId: reservationId,
      reservationStatus,
      cachedResponse: null,
      reason: "conflicting_usage_ids",
    };
  }

  const cacheValue = raw.pappers_response_cache;
  if (cacheValue !== undefined && cacheValue !== null) {
    const cache = cacheValue && typeof cacheValue === "object"
      ? cacheValue as Record<string, unknown>
      : {};
    const cacheRequestKey = nonEmptyString(cache.request_key);
    const cacheUsageId = nonEmptyString(cache.usage_id);
    const cacheSuccess = typeof cache.success === "boolean" ? cache.success : null;
    const cachePayloadValid = cacheSuccess === false ||
      (cache.payload !== null && typeof cache.payload === "object");
    if (
      cacheRequestKey !== requestKey ||
      !cacheUsageId ||
      cacheSuccess === null ||
      !cachePayloadValid
    ) {
      return {
        kind: "blocked",
        usageId: reservationId || localUsageId,
        reservationStatus,
        cachedResponse: null,
        reason: "invalid_cached_response",
      };
    }
    if (!reservationId || !reservationStatus) {
      return {
        kind: "blocked",
        usageId: cacheUsageId,
        reservationStatus: null,
        cachedResponse: null,
        reason: "cache_without_reservation",
      };
    }
    if (cacheUsageId !== reservationId || (localUsageId && cacheUsageId !== localUsageId)) {
      return {
        kind: "blocked",
        usageId: reservationId,
        reservationStatus,
        cachedResponse: null,
        reason: "conflicting_usage_ids",
      };
    }
    const completionCoherent = reservationStatus === "reserved"
      ? reservationSuccess === null
      : reservationSuccess !== null && reservationSuccess === cacheSuccess;
    if (!completionCoherent) {
      return {
        kind: "blocked",
        usageId: reservationId,
        reservationStatus,
        cachedResponse: null,
        reason: "invalid_reservation_completion",
      };
    }
    return {
      kind: "reuse_cached_response",
      usageId: reservationId,
      reservationStatus,
      cachedResponse: {
        request_key: cacheRequestKey,
        usage_id: cacheUsageId,
        success: cacheSuccess,
        http_status: typeof cache.http_status === "number" ? cache.http_status : null,
        error_code: nonEmptyString(cache.error_code),
        payload: cache.payload ?? null,
      },
      reason: "matching_cached_response",
    };
  }

  if (reservationId) {
    return {
      kind: "blocked",
      usageId: reservationId,
      reservationStatus,
      cachedResponse: null,
      reason: "provider_outcome_uncertain",
    };
  }
  if (!hasPappersState) {
    return {
      kind: "reserve_and_call",
      usageId: null,
      reservationStatus: null,
      cachedResponse: null,
      reason: "no_prior_operation",
    };
  }
  if (stage === "pappers_intent" && localRequestKey === requestKey && !localUsageId) {
    return {
      kind: "reserve_and_call",
      usageId: null,
      reservationStatus: null,
      cachedResponse: null,
      reason: "durable_intent_without_reservation",
    };
  }
  return {
    kind: "blocked",
    usageId: localUsageId,
    reservationStatus: null,
    cachedResponse: null,
    reason: "invalid_durable_intent",
  };
}

// Décide si un workflow asynchrone peut soumettre un nouveau travail payant.
// Toute preuve locale ou ledger est réutilisée sans fenêtre d'âge. Une reprise
// sans preuve, une ligne ledger sans identifiant ou deux identifiants distincts
// est bloquée : l'appelant ne doit jamais transformer l'incertitude en seconde
// soumission fournisseur.
export function decideProviderTaskRecovery(input: {
  localTaskId: unknown;
  priorLedgerRows: unknown;
  isRetry: boolean;
}): ProviderTaskRecoveryDecision {
  const localTaskId = nonEmptyString(input.localTaskId);
  const rows = Array.isArray(input.priorLedgerRows)
    ? input.priorLedgerRows
    : input.priorLedgerRows && typeof input.priorLedgerRows === "object"
    ? [input.priorLedgerRows]
    : [];

  const ledgerTaskIds = new Set<string>();
  for (const row of rows) {
    const record = row && typeof row === "object" ? row as Record<string, unknown> : {};
    const metadata = record.metadata && typeof record.metadata === "object"
      ? record.metadata as Record<string, unknown>
      : {};
    const taskId = nonEmptyString(metadata.provider_request_id);
    if (!taskId) {
      return { kind: "blocked", taskId: null, reason: "ledger_task_id_missing" };
    }
    ledgerTaskIds.add(taskId);
  }

  if (ledgerTaskIds.size > 1) {
    return { kind: "blocked", taskId: null, reason: "multiple_provider_tasks" };
  }
  const ledgerTaskId = ledgerTaskIds.values().next().value as string | undefined;
  if (localTaskId && ledgerTaskId && localTaskId !== ledgerTaskId) {
    return { kind: "blocked", taskId: null, reason: "conflicting_task_ids" };
  }
  if (localTaskId && ledgerTaskId) {
    return { kind: "reuse", taskId: localTaskId, reason: "local_and_ledger" };
  }
  if (ledgerTaskId) {
    return { kind: "reuse", taskId: ledgerTaskId, reason: "ledger" };
  }
  if (localTaskId) {
    return { kind: "reuse", taskId: localTaskId, reason: "local" };
  }
  if (input.isRetry) {
    return { kind: "blocked", taskId: null, reason: "retry_without_provider_proof" };
  }
  return { kind: "submit", taskId: null, reason: "no_prior_task" };
}

// Le waterfall ne peut rappeler Pappers que si aucune étape durable n'existe.
// Dès que les candidats sont persistés, toute reprise reste dans Dropcontact.
export function decideWaterfallProviderRecovery(
  rawData: unknown,
  priorDropcontactLedgerRows: unknown,
): WaterfallProviderRecoveryDecision {
  const raw = rawData && typeof rawData === "object"
    ? rawData as Record<string, unknown>
    : {};
  const rows = Array.isArray(priorDropcontactLedgerRows)
    ? priorDropcontactLedgerRows
    : priorDropcontactLedgerRows && typeof priorDropcontactLedgerRows === "object"
    ? [priorDropcontactLedgerRows]
    : [];
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const stage = nonEmptyString(raw.waterfall_stage);
  const hasLocalTask = Boolean(nonEmptyString(raw.dropcontact_request_id));
  const hasProviderProof = hasLocalTask || rows.length > 0;
  const validStage = [
    "dropcontact_ready",
    "dropcontact_submitting",
    "dropcontact_processing",
  ].includes(stage || "");
  const durableCandidates = raw.source === "waterfall" && validStage &&
    candidates.length > 0;
  const durablePappersStage = raw.source === "waterfall" && [
    "pappers_intent",
    "pappers_calling",
    "pappers_response_cached",
  ].includes(stage || "") && candidates.length === 0;

  if (!durableCandidates) {
    if (hasProviderProof) {
      return {
        kind: "blocked",
        taskId: null,
        reason: "provider_proof_without_candidates",
      };
    }
    if (durablePappersStage) {
      return {
        kind: "start_pappers",
        taskId: null,
        reason: "durable_pappers_stage",
      };
    }
    if (stage || candidates.length > 0) {
      return {
        kind: "blocked",
        taskId: null,
        reason: "invalid_durable_waterfall_stage",
      };
    }
    return {
      kind: "start_pappers",
      taskId: null,
      reason: "no_durable_waterfall_stage",
    };
  }

  const provider = decideProviderTaskRecovery({
    localTaskId: raw.dropcontact_request_id,
    priorLedgerRows: rows,
    isRetry: stage !== "dropcontact_ready",
  });
  if (provider.kind === "blocked") return provider;
  if (provider.kind === "reuse") {
    return {
      kind: "poll_dropcontact",
      taskId: provider.taskId,
      reason: provider.reason,
    };
  }
  return {
    kind: "submit_dropcontact",
    taskId: null,
    reason: "durable_candidates_ready",
  };
}

// Une lecture dataset déjà journalisée est rejouable uniquement pour le même
// dataset. Relire les items ne crée pas une nouvelle run Actor payante.
export function decideProviderDatasetRead(
  datasetIdValue: unknown,
  priorLedgerRows: unknown,
): ProviderDatasetReadDecision {
  const datasetId = nonEmptyString(datasetIdValue);
  if (!datasetId) {
    return { kind: "blocked", datasetId: null, reason: "dataset_id_missing" };
  }
  const rows = Array.isArray(priorLedgerRows)
    ? priorLedgerRows
    : priorLedgerRows && typeof priorLedgerRows === "object"
    ? [priorLedgerRows]
    : [];
  if (rows.length === 0) {
    return { kind: "fetch_dataset", datasetId, reason: "first_read" };
  }
  const recovery = decideProviderTaskRecovery({
    localTaskId: datasetId,
    priorLedgerRows: rows,
    isRetry: true,
  });
  if (recovery.kind === "blocked") {
    return { kind: "blocked", datasetId: null, reason: recovery.reason };
  }
  return { kind: "fetch_dataset", datasetId, reason: "replay_same_dataset" };
}

export function shouldContinueDropcontactPolling(
  providerCompleted: boolean,
): boolean {
  return !providerCompleted;
}

// HTTP 2xx only proves that the Edge Function answered. Completion requires an
// explicit business success; skipped/negative/ambiguous payloads remain
// retryable. Async submissions retain the queue job in `running` until their
// poller records the actual terminal outcome.
export function classifyEnrichmentInvocation(
  responseOk: boolean,
  payload: unknown,
): EnrichmentInvocationDisposition {
  const result = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const reason = nonEmptyString(result.error) ||
    nonEmptyString(result.reason) ||
    nonEmptyString(result.status);

  if (!responseOk) {
    return { kind: "retry", reason: reason || "http_error", externalTaskId: null };
  }
  if (result.skipped === true) {
    return { kind: "retry", reason: reason || "skipped", externalTaskId: null };
  }
  if (result.success === false) {
    return { kind: "retry", reason: reason || "business_failure", externalTaskId: null };
  }
  if (["failed", "error", "cancelled"].includes(nonEmptyString(result.status) || "")) {
    return { kind: "retry", reason: reason || "business_failure", externalTaskId: null };
  }

  const externalTaskId = nonEmptyString(result.apify_run_id) ||
    nonEmptyString(result.dropcontact_request_id);
  const asyncStatus = [
    "submitted",
    "processing",
    "linkedin_processing",
    "dropcontact_processing",
  ].includes(nonEmptyString(result.status) || "");
  if (result.already_running === true || externalTaskId || asyncStatus) {
    return {
      kind: "running",
      reason: result.already_running === true ? "already_running" : null,
      externalTaskId,
    };
  }
  if (result.success === true || result.status === "completed") {
    return { kind: "completed", reason: null, externalTaskId: null };
  }
  return {
    kind: "retry",
    reason: "missing_success_confirmation",
    externalTaskId: null,
  };
}

// Préflight explicable. La réservation autoritaire reste transactionnelle côté Postgres afin
// que deux enrichissements concurrents ne puissent pas consommer le dernier crédit ensemble.
export function evaluateCreditBudget(
  plan: CreditPlan | null | undefined,
  usage: number,
  reserved = 1,
  today = new Date().toISOString().slice(0, 10),
): CreditBudgetDecision {
  const limit = Number(plan?.monthly_credits ?? 0);
  const used = Number(usage);
  const needed = Number(reserved);
  const base = {
    limit: Number.isFinite(limit) ? limit : 0,
    used: Number.isFinite(used) ? used : 0,
    remaining_before: Number.isFinite(limit) && Number.isFinite(used) ? Math.max(0, limit - used) : 0,
    remaining_after: Number.isFinite(limit) && Number.isFinite(used) && Number.isFinite(needed)
      ? Math.max(0, limit - used - needed)
      : 0,
  };
  if (!plan) return { allowed: false, reason: "plan_missing", ...base };
  if (!Number.isFinite(limit) || limit <= 0) return { allowed: false, reason: "plan_zero", ...base };
  if (!plan.current_period_start || !plan.current_period_end || today < plan.current_period_start || today > plan.current_period_end) {
    return { allowed: false, reason: "period_not_current", ...base };
  }
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(needed) || needed <= 0) {
    return { allowed: false, reason: "usage_invalid", ...base };
  }
  if (used + needed > limit) return { allowed: false, reason: "plan_exhausted", ...base };
  return { allowed: true, reason: "ok", ...base };
}

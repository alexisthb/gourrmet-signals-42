import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { autoEnrichHighScorePappers, capRelevanceForSmallCompany } from "../_shared/pappers-auto-enrich.ts";
import { isIcpLegalForm } from "../_shared/pappers-icp.ts";
import {
  classifyPappersStoredRequest,
  employeesToPappersTranche,
  formatDateForPappers,
  pappersActualCredits,
  pappersAttemptRequestKey,
  PAPPERS_PAGES_PER_INVOCATION,
  type PappersEndpoint,
  PAPPERS_RESULTS_PER_PAGE,
  PAPPERS_RUN_LEASE_SECONDS,
  pappersPageCount,
  pappersGeoPriorityBonus,
  pappersNextPageCursor,
  pappersReservedCredits,
} from "../_shared/pappers-engine.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
} | undefined;

// Après un timeout/network error, Pappers peut avoir facturé sans que nous
// ayons reçu la réponse. Sans idempotency-key fournisseur, aucun retry
// automatique n'est honnête.
const PAPPERS_FETCH_TIMEOUT_MS = 20_000;

interface PappersQuery {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  last_run_at: string | null;
  parameters: {
    region?: string;
    years?: number[];  // Années d'anniversaire (ex: [10] = 10 ans)
    months_ahead?: number;  // Mois à l'avance pour détecter (ex: 9 = dans 9 mois)
    min_employees?: string;
    min_revenue?: number;
    code_naf?: string[];
    recent_days?: number;
    priority_regions?: string[];
  };
}

interface PappersCompany {
  siren: string;
  denomination: string;
  date_creation: string;
  forme_juridique: string;
  effectif: string;
  tranche_effectif: string;
  chiffre_affaires?: number;
  code_naf?: string;
  libelle_code_naf?: string;
  siege?: {
    code_postal?: string;
    ville?: string;
    region?: string;
  };
}

class PappersControlInterruption extends Error {
  constructor(public readonly status: 'paused' | 'cancelled') {
    super(`Scan ${status}`);
    this.name = 'PappersControlInterruption';
  }
}

class PappersContinuationRequired extends Error {
  constructor() {
    super('Continuation Pappers requise');
    this.name = 'PappersContinuationRequired';
  }
}

class PappersAmbiguousRequestError extends Error {
  readonly code = 'pappers_request_reconciliation_required';

  constructor(public readonly requestKey: string, message: string) {
    super(message);
    this.name = 'PappersAmbiguousRequestError';
  }
}

interface PappersCursor {
  query_id: string;
  endpoint: string;
  page: number;
  scope: string;
  attempt?: number;
  phase?: string;
  request_key?: string;
}

class PappersUnsupportedQueryError extends Error {
  readonly code = 'unsupported_without_company_identity';

  constructor(types: string[]) {
    super(`Requêtes Pappers non prises en charge sans identité société garantie: ${types.join(', ')}`);
    this.name = 'PappersUnsupportedQueryError';
  }
}

class PappersUnknownQueryError extends Error {
  readonly code = 'unsupported_query_type';

  constructor(types: string[]) {
    super(`Types de requête Pappers inconnus: ${types.join(', ')}`);
    this.name = 'PappersUnknownQueryError';
  }
}

class PappersInactiveQueryError extends Error {
  readonly code = 'pappers_query_inactive';

  constructor() {
    super('Cette requête Pappers est désactivée');
    this.name = 'PappersInactiveQueryError';
  }
}

interface PappersRun {
  scanId: string;
  leaseToken: string;
  resumeQueryId: string | null;
  resumeScope: string | null;
  executionQueries: PappersQuery[];
  executionSettings: Record<string, string>;
  executionCapturedAt: string;
  priorityRegions: string[];
  startPage: (queryId: string, endpoint: string, scope: string) => number;
  requestAttempt: (queryId: string, endpoint: string, page: number, scope: string) => number;
  checkpoint: (
    queryId: string,
    endpoint: string,
    page: number,
    scope: string,
    phase?: string,
    requestKey?: string,
    attempt?: number,
  ) => Promise<void>;
  assertLease: () => Promise<void>;
  reserveRequest: (input: {
    requestKey: string;
    queryId: string;
    endpoint: PappersEndpoint;
    page: number;
    scope: string;
    attempt: number;
    reservedCredits: number;
  }) => Promise<
    | { kind: 'prepared'; usageId: string; requestKey: string; reservedCredits: number }
    | { kind: 'cached'; requestKey: string; payload: PappersJsonResponse }
  >;
  markRequestDispatched: (input: {
    usageId: string;
    requestKey: string;
    cursor: PappersCursor;
  }) => Promise<void>;
  completeRequest: (input: {
    usageId: string;
    requestKey: string;
    actualCredits: number | null;
    itemsCount: number;
    success: boolean;
    httpStatus: number | null;
    errorCode: string | null;
    attemptedAt: string;
    metadata: Record<string, unknown>;
    responsePayload?: PappersJsonResponse;
    cursor: PappersCursor;
  }) => Promise<void>;
  recordPage: (input: {
    queryId: string;
    endpoint: 'recherche' | 'publications';
    page: number;
    returned: number;
    total?: number;
    totalPages?: number;
    scope?: string;
    nextCursor: PappersCursor;
  }) => Promise<void>;
  pageBudgetReached: () => boolean;
  handoff: () => Promise<{ leaseToken: string; queryId?: string }>;
  blockForReconciliation: (message: string) => Promise<void>;
  complete: () => Promise<void>;
  fail: (message: string) => Promise<void>;
}

interface PappersJsonResponse {
  resultats?: unknown[];
  total?: number;
  [key: string]: unknown;
}

async function pappersFetchJson<T extends PappersJsonResponse>(
  url: string,
  run: PappersRun,
  input: {
    queryId: string;
    endpoint: Extract<PappersEndpoint, 'recherche' | 'publications'>;
    page: number;
    scope: string;
    maximumResults: number;
  },
): Promise<T> {
  const reservedCredits = pappersReservedCredits(input.endpoint, input.maximumResults);
  const attempt = run.requestAttempt(input.queryId, input.endpoint, input.page, input.scope);
  const requestKey = pappersAttemptRequestKey({
    scanId: run.scanId,
    queryId: input.queryId,
    endpoint: input.endpoint,
    scope: input.scope,
    page: input.page,
    attempt,
  });
  const cursor: PappersCursor = {
    query_id: input.queryId,
    endpoint: input.endpoint,
    page: input.page,
    scope: input.scope,
    attempt,
  };

  await run.checkpoint(
    input.queryId,
    input.endpoint,
    input.page,
    input.scope,
    'before_reservation',
    requestKey,
    attempt,
  );
  const reservation = await run.reserveRequest({
    requestKey,
    queryId: input.queryId,
    endpoint: input.endpoint,
    page: input.page,
    scope: input.scope,
    attempt,
    reservedCredits,
  });
  if (reservation.kind === 'cached') {
    return reservation.payload as T;
  }

  await run.markRequestDispatched({
    usageId: reservation.usageId,
    requestKey,
    cursor,
  });

  const attemptedAt = new Date().toISOString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAPPERS_FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const errorCode = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error';
    try {
      await run.completeRequest({
        usageId: reservation.usageId,
        requestKey,
        actualCredits: null,
        itemsCount: 0,
        success: false,
        httpStatus: null,
        errorCode,
        attemptedAt,
        metadata: { ...input, attempt, billing: 'unknown', dispatch_state: 'ambiguous' },
        cursor,
      });
    } catch (completionError) {
      console.error('[fetch-pappers] tentative ambiguë non finalisée', completionError);
    }
    throw new PappersAmbiguousRequestError(
      requestKey,
      `Appel Pappers ${errorCode}: facturation et réponse à réconcilier avant toute reprise`,
    );
  }

  if (!response.ok) {
    let errorText = 'corps de réponse illisible';
    try { errorText = (await response.text()).slice(0, 500); } catch { /* statut HTTP conservé */ }
    clearTimeout(timer);
    const errorCode = `http_${response.status}`;
    try {
      await run.completeRequest({
        usageId: reservation.usageId,
        requestKey,
        actualCredits: null,
        itemsCount: 0,
        success: false,
        httpStatus: response.status,
        errorCode,
        attemptedAt,
        metadata: { ...input, attempt, billing: 'unknown', dispatch_state: 'ambiguous' },
        cursor,
      });
    } catch (completionError) {
      console.error('[fetch-pappers] tentative HTTP ambiguë non finalisée', completionError);
    }
    throw new PappersAmbiguousRequestError(
      requestKey,
      `Pappers /${input.endpoint} ${response.status}: ${errorText}. Aucun retry automatique.`,
    );
  }

  let data: T;
  try {
    data = await response.json() as T;
  } catch (error) {
    clearTimeout(timer);
    try {
      await run.completeRequest({
        usageId: reservation.usageId,
        requestKey,
        actualCredits: null,
        itemsCount: 0,
        success: false,
        httpStatus: response.status,
        errorCode: 'invalid_json',
        attemptedAt,
        metadata: { ...input, attempt, billing: 'unknown', dispatch_state: 'ambiguous' },
        cursor,
      });
    } catch (completionError) {
      console.error('[fetch-pappers] réponse invalide non finalisée', completionError);
    }
    throw new PappersAmbiguousRequestError(
      requestKey,
      'Réponse Pappers reçue mais illisible: facturation à réconcilier',
    );
  }
  clearTimeout(timer);

  if (!Array.isArray(data.resultats)) {
    try {
      await run.completeRequest({
        usageId: reservation.usageId,
        requestKey,
        actualCredits: null,
        itemsCount: 0,
        success: false,
        httpStatus: response.status,
        errorCode: 'invalid_payload',
        attemptedAt,
        metadata: { ...input, attempt, billing: 'unknown', dispatch_state: 'ambiguous' },
        cursor,
      });
    } catch (completionError) {
      console.error('[fetch-pappers] payload invalide non finalisé', completionError);
    }
    throw new PappersAmbiguousRequestError(
      requestKey,
      `Pappers /${input.endpoint}: réponse sans tableau resultats`,
    );
  }

  const returned = data.resultats.length;
  try {
    await run.completeRequest({
      usageId: reservation.usageId,
      requestKey,
      actualCredits: pappersActualCredits(input.endpoint, returned),
      itemsCount: returned,
      success: true,
      httpStatus: response.status,
      errorCode: null,
      attemptedAt,
      metadata: { ...input, attempt, returned, total: data.total ?? null, billing: 'known' },
      responsePayload: data,
      cursor,
    });
  } catch (error) {
    throw new PappersAmbiguousRequestError(
      requestKey,
      `Réponse Pappers reçue mais cache transactionnel non confirmé: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await run.assertLease();
  return data;
}

async function createPappersRun(
  supabase: any,
  requestedScanId?: string,
  requestedLeaseToken?: string,
  queryId?: string,
): Promise<PappersRun> {
  let scanId = requestedScanId;
  let leaseToken = requestedLeaseToken;
  if (!scanId) {
    const { data: started, error: startError } = await supabase.rpc('start_pappers_scan', {
      p_query_id: queryId || null,
      p_scan_type: queryId ? 'query' : 'all_queries',
      p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
    });
    if (startError || !started?.scan_id || !started?.lease_token) {
      throw new Error(`Impossible de créer le run Pappers: ${startError?.message || 'réponse vide'}`);
    }
    scanId = started.scan_id;
    leaseToken = started.lease_token;
  }
  if (!leaseToken) throw new Error('Token de bail Pappers obligatoire');

  const { data: claimed, error: claimError } = await supabase.rpc('claim_pappers_scan', {
    p_scan_id: scanId,
    p_lease_token: leaseToken,
    p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
  });
  if (claimError || !claimed?.lease_token) {
    throw new Error(`Impossible de réclamer le run Pappers: ${claimError?.message || 'réponse vide'}`);
  }

  const activeScanId = scanId as string;
  // Le claim fait tourner le token : un ancien worker qui se réveille après
  // expiration ne peut plus écrire avec le ticket de claim précédent.
  const activeLeaseToken = claimed.lease_token as string;
  const savedCursor = typeof claimed.last_cursor === 'string' ? claimed.last_cursor : null;
  let processed = Number(claimed.processed_results || 0);
  let pagesProcessed = 0;
  let cursor: PappersCursor | null = null;
  try { cursor = savedCursor ? JSON.parse(savedCursor) : null; } catch { cursor = null; }
  const executionSnapshot = claimed.execution_snapshot;
  const executionQueries = Array.isArray(executionSnapshot?.queries)
    ? executionSnapshot.queries as PappersQuery[]
    : [];
  const executionSettings = executionSnapshot?.settings
    && typeof executionSnapshot.settings === 'object'
    && !Array.isArray(executionSnapshot.settings)
    ? executionSnapshot.settings as Record<string, string>
    : {};
  const priorityRegions = Array.isArray(executionSnapshot?.priority_regions)
    ? executionSnapshot.priority_regions.filter((region: unknown): region is string => typeof region === 'string')
    : [];
  const executionCapturedAt = typeof executionSnapshot?.captured_at === 'string'
    ? executionSnapshot.captured_at
    : '';
  if (executionQueries.length === 0 || !Number.isFinite(Date.parse(executionCapturedAt))) {
    throw new Error('Snapshot d’exécution Pappers absent, vide ou non daté');
  }

  const throwLeaseState = async (fallback: string): Promise<never> => {
    const { data: current } = await supabase
      .from('pappers_scan_progress')
      .select('status')
      .eq('id', activeScanId)
      .maybeSingle();
    if (current?.status === 'paused' || current?.status === 'cancelled') {
      throw new PappersControlInterruption(current.status);
    }
    throw new Error(fallback);
  };

  const heartbeat = async () => {
    const { data, error } = await supabase.rpc('heartbeat_pappers_scan', {
      p_scan_id: activeScanId,
      p_lease_token: activeLeaseToken,
      p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
    });
    if (error) throw new Error(`Heartbeat Pappers en échec: ${error.message}`);
    if (data === true) return;
    return await throwLeaseState('Bail Pappers expiré ou remplacé');
  };

  const persistCursor = async (next: PappersCursor) => {
    await heartbeat();
    const { data, error } = await supabase.from('pappers_scan_progress')
      .update({ last_cursor: JSON.stringify(next), heartbeat_at: new Date().toISOString() })
      .eq('id', activeScanId)
      .eq('lease_token', activeLeaseToken)
      .eq('status', 'running')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Checkpoint Pappers non persisté: ${error.message}`);
    if (!data) await throwLeaseState('Checkpoint Pappers refusé: bail expiré ou remplacé');
    cursor = next;
  };

  return {
    scanId: activeScanId,
    leaseToken: activeLeaseToken,
    resumeQueryId: cursor?.query_id || null,
    resumeScope: cursor?.scope || null,
    executionQueries,
    executionSettings,
    executionCapturedAt,
    priorityRegions,
    startPage(targetQueryId, endpoint, scope) {
      return cursor?.query_id === targetQueryId && cursor.endpoint === endpoint && cursor.scope === scope
        ? Math.max(1, Number(cursor.page || 1))
        : 1;
    },
    requestAttempt(targetQueryId, endpoint, page, scope) {
      return cursor?.query_id === targetQueryId
          && cursor.endpoint === endpoint
          && cursor.page === page
          && cursor.scope === scope
        ? Math.max(0, Number(cursor.attempt || 0))
        : 0;
    },
    async checkpoint(targetQueryId, endpoint, page, scope, phase, requestKey, attempt) {
      await persistCursor({
        query_id: targetQueryId,
        endpoint,
        page,
        scope,
        phase,
        request_key: requestKey,
        attempt: Math.max(0, Number(attempt || 0)),
      });
    },
    assertLease: heartbeat,
    async reserveRequest(input) {
      await heartbeat();
      const { data: existing, error: existingError } = await supabase
        .from('pappers_credit_usage')
        .select('id,reserved_credits,reservation_status,success,details')
        .eq('request_key', input.requestKey)
        .maybeSingle();
      if (existingError) {
        throw new Error(`Tentative Pappers illisible: ${existingError.message}`);
      }
      if (existing) {
        const { data: cached, error: cacheError } = await supabase
          .from('pappers_request_cache')
          .select('payload')
          .eq('usage_id', existing.id)
          .maybeSingle();
        if (cacheError) throw new Error(`Cache Pappers illisible: ${cacheError.message}`);
        const decision = classifyPappersStoredRequest({
          reservationStatus: existing.reservation_status,
          success: existing.success,
          dispatchState: existing.details?.dispatch_state,
          hasCachedPayload: !!cached?.payload,
        });
        if (decision === 'cached') {
          return {
            kind: 'cached' as const,
            requestKey: input.requestKey,
            payload: cached!.payload as PappersJsonResponse,
          };
        }
        if (decision === 'prepared') {
          return {
            kind: 'prepared' as const,
            usageId: existing.id as string,
            requestKey: input.requestKey,
            reservedCredits: Number(existing.reserved_credits ?? input.reservedCredits),
          };
        }
        throw new PappersAmbiguousRequestError(
          input.requestKey,
          decision === 'terminal_failure'
            ? 'La tentative Pappers précédente a échoué et doit être arbitrée avant retry'
            : 'La tentative Pappers précédente peut avoir été facturée sans réponse durable',
        );
      }

      const { data, error } = await supabase.rpc('reserve_pappers_credits', {
        p_request_key: input.requestKey,
        p_operation: input.endpoint,
        p_reserved_credits: input.reservedCredits,
        p_query_id: input.queryId,
        p_scan_id: activeScanId,
        p_signal_id: null,
        p_run_id: activeScanId,
        p_metadata: {
          page: input.page,
          scope: input.scope,
          attempt: input.attempt,
          lease_token: activeLeaseToken,
          dispatch_state: 'prepared',
        },
      });
      if (error || !data?.usage_id) {
        throw new Error(`Réservation Pappers refusée: ${error?.message || 'usage_id absent'}`);
      }
      return {
        kind: 'prepared' as const,
        usageId: data.usage_id as string,
        requestKey: input.requestKey,
        reservedCredits: Number(data.reserved_credits ?? input.reservedCredits),
      };
    },
    async markRequestDispatched(input) {
      const { data, error } = await supabase.rpc('mark_pappers_request_dispatched', {
        p_usage_id: input.usageId,
        p_request_key: input.requestKey,
        p_scan_id: activeScanId,
        p_lease_token: activeLeaseToken,
        p_cursor: input.cursor,
        p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
      });
      if (error) {
        throw new PappersAmbiguousRequestError(
          input.requestKey,
          `Dispatch Pappers non confirmé: ${error.message}`,
        );
      }
      if (data !== true) {
        throw new PappersAmbiguousRequestError(
          input.requestKey,
          'Tentative Pappers déjà dispatchée: aucun second appel autorisé',
        );
      }
      cursor = { ...input.cursor, phase: 'dispatched', request_key: input.requestKey };
    },
    async completeRequest(input) {
      const request = input.success && input.responsePayload
        ? supabase.rpc('complete_pappers_search_request', {
          p_usage_id: input.usageId,
          p_request_key: input.requestKey,
          p_scan_id: activeScanId,
          p_lease_token: activeLeaseToken,
          p_actual_credits: input.actualCredits,
          p_items_count: input.itemsCount,
          p_http_status: input.httpStatus,
          p_attempted_at: input.attemptedAt,
          p_metadata: input.metadata,
          p_payload: input.responsePayload,
          p_cursor: input.cursor,
          p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
        })
        : supabase.rpc('complete_pappers_credits', {
          p_usage_id: input.usageId,
          p_request_key: input.requestKey,
          p_actual_credits: input.actualCredits,
          p_items_count: input.itemsCount,
          p_success: input.success,
          p_http_status: input.httpStatus,
          p_error_code: input.errorCode,
          p_attempted_at: input.attemptedAt,
          p_metadata: input.metadata,
        });
      const { error } = await request;
      if (error && input.success) {
        // Une réponse PostgREST perdue après commit ne doit pas transformer une
        // réponse déjà cachée en ambiguïté. La preuve durable par usage+clé est
        // suffisante pour poursuivre sans nouvel appel fournisseur.
        const { data: cached, error: cacheError } = await supabase
          .from('pappers_request_cache')
          .select('usage_id')
          .eq('usage_id', input.usageId)
          .eq('request_key', input.requestKey)
          .maybeSingle();
        if (cacheError || !cached) {
          throw new Error(`Finalisation Pappers non persistée: ${error.message}`);
        }
      } else if (error) {
        throw new Error(`Finalisation Pappers non persistée: ${error.message}`);
      }
      if (input.success) {
        cursor = {
          ...input.cursor,
          phase: 'response_cached',
          request_key: input.requestKey,
        };
      }
    },
    async recordPage(input) {
      processed += input.returned;

      const { data, error: progressError } = await supabase.from('pappers_scan_progress').update({
        current_page: input.page,
        total_pages: input.totalPages ?? null,
        total_results: input.total ?? null,
        processed_results: processed,
        heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + PAPPERS_RUN_LEASE_SECONDS * 1_000).toISOString(),
        last_cursor: JSON.stringify(input.nextCursor),
      })
        .eq('id', activeScanId)
        .eq('lease_token', activeLeaseToken)
        .eq('status', 'running')
        .gt('lease_expires_at', new Date().toISOString())
        .select('id')
        .maybeSingle();
      if (progressError) throw new Error(`Progression Pappers non persistée: ${progressError.message}`);
      if (!data) await throwLeaseState('Progression Pappers refusée: bail expiré ou remplacé');
      cursor = input.nextCursor;
      pagesProcessed++;
    },
    pageBudgetReached() {
      return pagesProcessed >= PAPPERS_PAGES_PER_INVOCATION;
    },
    async handoff() {
      const { data, error } = await supabase.rpc('handoff_pappers_scan', {
        p_scan_id: activeScanId,
        p_lease_token: activeLeaseToken,
        p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
      });
      if (error || !data?.lease_token) {
        return await throwLeaseState(`Handoff Pappers refusé: ${error?.message || 'token absent'}`);
      }
      return {
        leaseToken: data.lease_token as string,
        queryId: (data.query_id as string | null) || undefined,
      };
    },
    async blockForReconciliation(message) {
      const { data, error } = await supabase.from('pappers_scan_progress').update({
        status: 'paused',
        error_message: message.slice(0, 2_000),
        lease_token: null,
        lease_expires_at: null,
        heartbeat_at: new Date().toISOString(),
      })
        .eq('id', activeScanId)
        .eq('lease_token', activeLeaseToken)
        .eq('status', 'running')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`Blocage Pappers non persisté: ${error.message}`);
      if (!data) await throwLeaseState('Blocage Pappers refusé: bail remplacé');
    },
    async complete() {
      const { data, error } = await supabase.from('pappers_scan_progress').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        error_message: null,
        lease_token: null,
        lease_expires_at: null,
      })
        .eq('id', activeScanId)
        .eq('lease_token', activeLeaseToken)
        .eq('status', 'running')
        .gt('lease_expires_at', new Date().toISOString())
        .select('id')
        .maybeSingle();
      if (error) throw new Error(`Run Pappers non finalisé: ${error.message}`);
      if (!data) {
        const { data: current } = await supabase.from('pappers_scan_progress').select('status').eq('id', activeScanId).single();
        if (current?.status === 'paused' || current?.status === 'cancelled') {
          throw new PappersControlInterruption(current.status);
        }
        throw new Error(`Run Pappers non finalisé depuis l'état ${current?.status || 'inconnu'}`);
      }
    },
    async fail(message) {
      const { data, error } = await supabase.from('pappers_scan_progress').update({
        status: 'error',
        completed_at: new Date().toISOString(),
        error_message: message.slice(0, 2_000),
        lease_token: null,
        lease_expires_at: null,
      })
        .eq('id', activeScanId)
        .eq('lease_token', activeLeaseToken)
        .gt('lease_expires_at', new Date().toISOString())
        .in('status', ['pending', 'running'])
        .select('id,status')
        .maybeSingle();
      if (error) console.error('[fetch-pappers] impossible de marquer le run en erreur', error.message);
      else if (!data) {
        const { data: current } = await supabase
          .from('pappers_scan_progress')
          .select('status')
          .eq('id', activeScanId)
          .maybeSingle();
        console.warn('[fetch-pappers] échec non persisté après transition concurrente', {
          scanId: activeScanId,
          currentStatus: current?.status || 'missing',
        });
      }
    },
  };
}

async function dispatchPappersContinuation(input: {
  supabaseUrl: string;
  serviceKey: string;
  scanId: string;
  leaseToken: string;
  queryId?: string;
}) {
  const response = await fetch(`${input.supabaseUrl}/functions/v1/fetch-pappers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.serviceKey}`,
    },
    body: JSON.stringify({
      scanId: input.scanId,
      leaseToken: input.leaseToken,
      queryId: input.queryId,
    }),
  });
  const body = await response.text();
  if (!response.ok && response.status !== 202) {
    throw new Error(`Continuation Pappers HTTP ${response.status}: ${body.slice(0, 1_000)}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  let run: PappersRun | null = null;
  try {
    const PAPPERS_API_KEY = Deno.env.get('PAPPERS_API_KEY');
    if (!PAPPERS_API_KEY) {
      throw new Error('PAPPERS_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { queryId, scanId, leaseToken } = await req.json().catch(() => ({}));
    run = await createPappersRun(supabase, scanId, leaseToken, queryId);
    
    console.log(`[fetch-pappers] Starting scan${queryId ? ` for query ${queryId}` : ' for all active queries'}`);

    // Le snapshot est figé au démarrage du run. Une édition de requête ou de
    // seuil pendant un handoff ne peut donc pas changer la page logique.
    const queries = run.executionQueries;
    if (queries.length === 0) {
      throw new Error('Aucune requête Pappers active à exécuter');
    }

    let totalSignals = 0;
    const orderedQueries = queries;
    const unsupportedQueries = orderedQueries.filter((query) =>
      ['nomination', 'capital_increase', 'transfer'].includes(query.type)
    );
    const supportedQueries = orderedQueries.filter((query) =>
      query.type === 'anniversary' || query.type === 'creation'
    );
    const unknownQueries = orderedQueries.filter((query) =>
      !['anniversary', 'creation', 'nomination', 'capital_increase', 'transfer'].includes(query.type)
    );

    // Valider tout le lot avant le premier appel payant. Une ancienne requête
    // Publication réactivée ou un type inconnu ne peut donc produire ni coût ni
    // succès partiel avant l'erreur métier explicite.
    if (unsupportedQueries.length > 0) {
      throw new PappersUnsupportedQueryError([...new Set(unsupportedQueries.map((query) => query.type))]);
    }
    if (unknownQueries.length > 0) {
      throw new PappersUnknownQueryError([...new Set(unknownQueries.map((query) => query.type))]);
    }
    if (queryId && orderedQueries[0]?.is_active !== true) {
      throw new PappersInactiveQueryError();
    }

    const resumeIndex = run.resumeQueryId === '__complete__'
      ? supportedQueries.length
      : Math.max(0, supportedQueries.findIndex((query) => query.id === run!.resumeQueryId));
    const queriesToRun = run.resumeQueryId ? supportedQueries.slice(resumeIndex) : supportedQueries;

    for (let index = 0; index < queriesToRun.length; index++) {
      const query = queriesToRun[index];
      console.log(`[fetch-pappers] Processing query: ${query.name} (${query.type})`);

      try {
        await processQuery(query, PAPPERS_API_KEY, supabase, run);
        const { count: querySignals, error: querySignalsError } = await supabase
          .from('pappers_signals')
          .select('*', { count: 'exact', head: true })
          .eq('scan_id', run.scanId)
          .eq('query_id', query.id);
        if (querySignalsError) {
          throw new Error(`Compteur de requête Pappers illisible: ${querySignalsError.message}`);
        }
        totalSignals += querySignals || 0;

        // Update last_run_at
        const { error: queryUpdateError } = await supabase
          .from('pappers_queries')
          .update({ 
            last_run_at: new Date().toISOString(),
            signals_count: querySignals || 0
          })
          .eq('id', query.id);
        if (queryUpdateError) throw new Error(`Requête Pappers non finalisée: ${queryUpdateError.message}`);
        const nextQueryId = queriesToRun[index + 1]?.id || '__complete__';
        await run.checkpoint(nextQueryId, 'control', 1, 'query_start');

      } catch (error) {
        if (error instanceof PappersControlInterruption) throw error;
        console.error(`[fetch-pappers] Error processing query ${query.name}:`, error);
        throw error;
      }
    }

    const { count: persistedSignals, error: persistedSignalsError } = await supabase
      .from('pappers_signals')
      .select('*', { count: 'exact', head: true })
      .eq('scan_id', run.scanId);
    if (persistedSignalsError) {
      throw new Error(`Compteur du scan Pappers illisible: ${persistedSignalsError.message}`);
    }
    totalSignals = persistedSignals || 0;
    console.log(`[fetch-pappers] Scan completed. Total signals: ${totalSignals}`);

    // Alerte précoce : un scan qui ne crée AUCUN signal sur des requêtes actives est le
    // symptôme exact de la panne « 0 signal Pappers depuis 4 mois » (format de date cassé).
    // Ce warning rend la panne visible dans les logs au lieu de passer inaperçue des mois.
    if (totalSignals === 0 && queries.length > 0) {
      console.warn(`[fetch-pappers] ⚠️ 0 signal créé sur ${queries.length} requête(s) active(s). À vérifier si cela persiste : format de date (JJ-MM-AAAA attendu par Pappers), clé PAPPERS_API_KEY, et seuils ICP (CA/effectif) éventuellement trop stricts.`);
    }

    // Libérer le bail avant l'enrichissement post-scan : cette étape indépendante ne doit
    // pas maintenir artificiellement un run Pappers actif.
    await run.complete();

    // L'enrichissement reste post-scan. Son échec est visible dans ses propres jobs mais ne
    // réécrit pas le résultat Pappers, dont les signaux sont déjà persistés.
    try {
      await autoEnrichHighScorePappers(supabase);
    } catch (e) {
      console.error('[fetch-pappers] Auto-enrich Pappers a échoué (scan non impacté):', e instanceof Error ? e.message : e);
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'completed',
      scanId: run.scanId,
      signalsCount: totalSignals,
      queriesProcessed: queriesToRun.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[fetch-pappers] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof PappersContinuationRequired && run) {
      try {
        const handoff = await run.handoff();
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceKey) throw new Error('Configuration Supabase absente pour le handoff');
        const continuation = dispatchPappersContinuation({
          supabaseUrl,
          serviceKey,
          scanId: run.scanId,
          leaseToken: handoff.leaseToken,
          queryId: handoff.queryId,
        });
        if (typeof EdgeRuntime !== 'undefined') {
          EdgeRuntime.waitUntil(continuation.catch((dispatchError) => {
            console.error('[fetch-pappers] handoff HTTP perdu; le recovery cron reprendra le même run', dispatchError);
          }));
        } else {
          await continuation;
        }
        return new Response(JSON.stringify({
          success: true,
          status: 'pending',
          continuation: true,
          scanId: run.scanId,
        }), {
          status: 202,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (handoffError) {
        const handoffMessage = handoffError instanceof Error ? handoffError.message : String(handoffError);
        return new Response(JSON.stringify({
          success: false,
          status: 'error',
          code: 'pappers_handoff_failed',
          scanId: run.scanId,
          error: handoffMessage,
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }
    if (error instanceof PappersAmbiguousRequestError && run) {
      try {
        await run.blockForReconciliation(`[${error.code}] ${error.message}; request_key=${error.requestKey}`);
      } catch (blockError) {
        console.error('[fetch-pappers] blocage de réconciliation non persisté', blockError);
      }
      return new Response(JSON.stringify({
        success: false,
        status: 'reconciliation_required',
        code: error.code,
        scanId: run.scanId,
        requestKey: error.requestKey,
        error: errorMessage,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (error instanceof PappersControlInterruption) {
      return new Response(JSON.stringify({
        success: false,
        status: error.status,
        scanId: run?.scanId,
        message: errorMessage,
      }), {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const businessError = error instanceof PappersUnsupportedQueryError
      || error instanceof PappersUnknownQueryError
      || error instanceof PappersInactiveQueryError;
    const errorCode = businessError ? error.code : 'pappers_scan_failed';
    if (run) await run.fail(`[${errorCode}] ${errorMessage}`);
    return new Response(JSON.stringify({
      success: false,
      status: 'error',
      code: errorCode,
      scanId: run?.scanId,
      error: errorMessage,
    }), {
      status: businessError ? 422 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processQuery(query: PappersQuery, apiKey: string, supabase: any, run: PappersRun): Promise<number> {
  if (run.resumeQueryId === query.id && run.resumeScope === 'query_complete') {
    return 0;
  }
  const effectiveQuery: PappersQuery = {
    ...query,
    parameters: { ...(query.parameters || {}), priority_regions: run.priorityRegions },
  };
  const { type } = effectiveQuery;

  if (type === 'anniversary') {
    return await searchAnniversaries(effectiveQuery, apiKey, supabase, run);
  } else if (type === 'creation') {
    return await searchCreations(effectiveQuery, apiKey, supabase, run);
  }

  if (['nomination', 'capital_increase', 'transfer'].includes(type)) {
    throw new PappersUnsupportedQueryError([type]);
  }

  // type='radiation' (et autres futurs types) : non implémenté, on log explicitement
  // plutôt que de retourner 0 en silence comme avant.
  throw new Error(`Type de requête Pappers non implémenté: ${type} (${query.id})`);
}

// PANNE PAPPERS « 0 signal depuis des mois » : l'API Pappers attend les dates au format
// JJ-MM-AAAA sur /recherche (date_creation_min/max), et NON AAAA-MM-JJ. run-pappers-scan
// avait été corrigé (cf. son formatDateForPappers + commentaire IMPORTANT) ; fetch-pappers,
// LE scanner réellement schedulé par le cron quotidien, ne l'était PAS -> l'API ne
// renvoyait rien -> aucun signal Pappers créé. Cette fonction rétablit le bon format.
// BUG « 0 signal » (2e cause, indépendante du format de date) : l'UI stocke l'effectif
// minimum en NOMBRE BRUT ("10","20","50","100","250" — cf. Settings.tsx), mais l'API Pappers
// attend un CODE de tranche INSEE/Sirene sur tranche_effectif_min. Aucune des valeurs du
// menu déroulant n'est un code valide -> le filtre ne matche AUCUNE entreprise dès qu'un
// effectif min est réglé. Cette table convertit un effectif brut vers le bon code de tranche.
// Codes Sirene : 11=10-19, 12=20-49, 21=50-99, 22=100-199, 31=200-249, 32=250-499,
// 41=500-999, 42=1000-1999, 51=2000-4999, 52=5000-9999, 53=10000+.
// Scan incrémental auto-cicatrisant : nombre de jours de dates de création couverts à
// chaque passage (fenêtre glissante) au lieu d'un seul jour exact — voir searchAnniversaries.
const INCREMENTAL_WINDOW_DAYS = 35;

const PAPPERS_REVENUE_FLOOR = 1_000_000; // plancher CA par défaut (ICP premium), aligné sur run-pappers-scan

// Lit les seuils ICP : per-query sinon réglages globaux Settings
// (min_revenue_pappers / min_employees_pappers), avec un plancher CA par défaut de 1M€.
// Câble enfin ces réglages "fantômes" (écrits dans Settings mais lus par personne).
async function getPappersFloors(
  parameters: any,
  settings: Record<string, string>,
): Promise<{ minRevenue: number; minEmployeesTranche: string | null }> {
  const globalRev = parseInt(settings.min_revenue_pappers || '', 10) || 0;
  const globalEmp = settings.min_employees_pappers || null;

  const queryRev = typeof parameters?.min_revenue === 'number' ? parameters.min_revenue : 0;
  const minRevenue = Math.max(globalRev, queryRev) || PAPPERS_REVENUE_FLOOR;
  // Effectif brut ("20") -> code de tranche INSEE ("12"). Sans cette conversion,
  // tranche_effectif_min recevait un nombre invalide et ne matchait aucune entreprise.
  const minEmpRaw = parseInt(String(parameters?.min_employees ?? globalEmp ?? ''), 10);
  const minEmployeesTranche = Number.isFinite(minEmpRaw) && minEmpRaw > 0
    ? employeesToPappersTranche(minEmpRaw)
    : null;
  return { minRevenue, minEmployeesTranche };
}

// Mois d'anticipation des anniversaires : per-query (months_ahead) sinon réglage global
// Settings (pappers_anticipation_months, câblé côté UI mais lu par personne jusqu'ici),
// sinon défaut 9 mois — laisse le temps d'identifier, contacter et livrer un cadeau avant
// la date d'anniversaire. Câble enfin ce réglage "fantôme".
async function getAnticipationMonths(
  parameters: any,
  settings: Record<string, string>,
): Promise<number> {
  if (typeof parameters?.months_ahead === 'number' && parameters.months_ahead > 0) {
    return parameters.months_ahead;
  }
  const n = parseInt(settings.pappers_anticipation_months || '', 10);
  if (Number.isFinite(n) && n > 0) return n;
  return 9;
}

async function searchAnniversaries(query: PappersQuery, apiKey: string, supabase: any, run: PappersRun): Promise<number> {
  const { parameters, id: queryId, last_run_at } = query;
  const anniversaryYears = parameters.years || [10];  // Ex: 10 ans
  const monthsAhead = await getAnticipationMonths(parameters, run.executionSettings);  // Ex: dans 9 mois

  let signalsCreated = 0;
  const floors = await getPappersFloors(parameters, run.executionSettings);
  const today = new Date(run.executionCapturedAt);
  
  // Calculer la date cible : aujourd'hui + X mois
  const targetDate = new Date(today);
  targetDate.setMonth(targetDate.getMonth() + monthsAhead);
  
  // Déterminer si c'est un premier scan ou un scan incrémental
  const isFirstRun = !last_run_at;
  
  const resumeYear = run.resumeQueryId === queryId && run.resumeScope?.startsWith('anniversary:')
    ? Number(run.resumeScope.split(':')[1])
    : null;
  const resumeYearIndex = resumeYear === null ? 0 : anniversaryYears.indexOf(resumeYear);
  const yearsToRun = anniversaryYears.slice(Math.max(0, resumeYearIndex));

  for (let yearIndex = 0; yearIndex < yearsToRun.length; yearIndex++) {
    const targetYears = yearsToRun[yearIndex];
    const scope = `anniversary:${targetYears}`;
    // Date de création = date cible - années d'anniversaire
    const creationYear = targetDate.getFullYear() - targetYears;
    const creationMonth = targetDate.getMonth();
    const creationDay = targetDate.getDate();
    
    let dateCreationMin: string;
    let dateCreationMax: string;
    
    if (isFirstRun) {
      // Premier scan : on prend TOUT le mois de création pour rattraper
      // Exemple : si anniversaire le 15/09/2035, on cherche créations en 09/2025
      dateCreationMin = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(creationYear, creationMonth + 1, 0).getDate();
      dateCreationMax = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      
      console.log(`[fetch-pappers] PREMIER SCAN - Entreprises créées en ${String(creationMonth + 1).padStart(2, '0')}/${creationYear} (anniversaire ${targetYears} ans dans ${monthsAhead} mois)`);
    } else {
      // Scan incrémental AUTO-CICATRISANT : au lieu d'UN seul jour exact (fragile — tout jour
      // manqué par le cron était perdu à jamais, et un scan mono-jour renvoie 0 la plupart du
      // temps car peu d'entreprises sont créées un jour donné il y a ~X ans), on couvre une
      // FENÊTRE glissante des INCREMENTAL_WINDOW_DAYS derniers jours de dates de création
      // cibles. Le dédup (siren, type) + l'index unique rendent le recouvrement idempotent.
      const targetCreation = new Date(creationYear, creationMonth, creationDay);
      const windowStart = new Date(targetCreation);
      windowStart.setDate(windowStart.getDate() - INCREMENTAL_WINDOW_DAYS);
      dateCreationMin = `${windowStart.getFullYear()}-${String(windowStart.getMonth() + 1).padStart(2, '0')}-${String(windowStart.getDate()).padStart(2, '0')}`;
      dateCreationMax = `${creationYear}-${String(creationMonth + 1).padStart(2, '0')}-${String(creationDay).padStart(2, '0')}`;

      console.log(`[fetch-pappers] SCAN INCRÉMENTAL - Entreprises créées du ${dateCreationMin} au ${dateCreationMax} (fenêtre ${INCREMENTAL_WINDOW_DAYS}j, anniversaire ${targetYears} ans le ${targetDate.toISOString().split('T')[0]})`);
    }
    
    // Pagination pour récupérer tous les résultats
    let page = run.startPage(queryId, 'recherche', scope);
    let hasMore = true;
    const perPage = PAPPERS_RESULTS_PER_PAGE;
    
    while (hasMore) {
      const params = new URLSearchParams({
        api_token: apiKey,
        date_creation_min: formatDateForPappers(dateCreationMin),
        date_creation_max: formatDateForPappers(dateCreationMax),
        par_page: String(perPage),
        page: String(page),
        statut: 'actif',
      });

      if (parameters.region && parameters.region !== 'all') {
        params.append('region', parameters.region);
      }

      if (floors.minEmployeesTranche) {
        params.append('tranche_effectif_min', floors.minEmployeesTranche);
      }

      // Diagnostic : log des filtres EXACTS envoyés (hors api_token) au 1er appel. Rend
      // immédiatement visible dans les logs tout filtre qui viderait le résultat (tranche,
      // région, dates) — ce qui manquait pour diagnostiquer les scans « 0 signal ».
      if (page === 1) {
        console.log(`[fetch-pappers] Filtres recherche → date_creation ${formatDateForPappers(dateCreationMin)}..${formatDateForPappers(dateCreationMax)} | region=${parameters.region ?? 'national'} | tranche_effectif_min=${floors.minEmployeesTranche ?? 'aucun'} | CA≥${floors.minRevenue}€`);
      }

      try {
        const data = await pappersFetchJson<{
          resultats?: PappersCompany[];
          total?: number;
        }>(`https://api.pappers.fr/v2/recherche?${params.toString()}`, run, {
          queryId,
          endpoint: 'recherche',
          page,
          scope,
          maximumResults: perPage,
        });
        const companies: PappersCompany[] = data.resultats || [];
        const total = Number(data.total || 0);
        console.log(`[fetch-pappers] Page ${page}: ${companies.length} entreprises (total: ${total})`);

        let skippedDedup = 0;
        let skippedCa = 0;
        let insertErrors = 0;
        let inserted = 0;

        for (const company of companies) {
          // Filtre ICP : ignorer les entités hors cible (associations, écoles, public,
          // particuliers, sociétés civiles…) — aucun décideur d'entreprise à démarcher.
          if (!isIcpLegalForm(company.forme_juridique)) continue;

          // Vérifier si le signal existe déjà (par SIREN + type)
          const { data: existing } = await supabase
            .from('pappers_signals')
            .select('id')
            .eq('siren', company.siren)
            .eq('signal_type', 'anniversary')
            .maybeSingle();

          if (existing) { skippedDedup++; continue; }

          // Plancher CA (ICP premium) : on écarte les sociétés dont le CA connu est sous le
          // seuil. CA inconnu -> on laisse passer (ne pas pénaliser l'absence de donnée).
          if (typeof company.chiffre_affaires === 'number' && company.chiffre_affaires > 0 && company.chiffre_affaires < floors.minRevenue) {
            skippedCa++;
            continue;
          }

          // Plafond petite entreprise APRÈS le bonus jalon (un petit centenaire aurait +35 et
          // passerait à tort 4/5) : PME/Inconnu sans CA >= 5 M€ -> relevance <= 69 (3★, hors gate).
          const score = capRelevanceForSmallCompany(
            { effectif: company.effectif || company.tranche_effectif, chiffre_affaires: company.chiffre_affaires, code_naf: company.code_naf },
            Math.min(100, calculateRelevanceScore(company, parameters) + milestoneBonus(targetYears)),
          );

          const anniversaryDate = new Date(company.date_creation);
          anniversaryDate.setFullYear(anniversaryDate.getFullYear() + targetYears);

          const { error: insertError } = await supabase
            .from('pappers_signals')
            .insert({
              scan_id: run.scanId,
              query_id: queryId,
              company_name: company.denomination,
              siren: company.siren,
              signal_type: 'anniversary',
              signal_detail: `Fêtera ses ${targetYears} ans le ${anniversaryDate.toLocaleDateString('fr-FR')} (créée le ${new Date(company.date_creation).toLocaleDateString('fr-FR')})`,
              relevance_score: score,
              company_data: {
                date_creation: company.date_creation,
                anniversary_date: anniversaryDate.toISOString().split('T')[0],
                anniversary_years: targetYears,
                forme_juridique: company.forme_juridique,
                effectif: company.effectif || company.tranche_effectif,
                chiffre_affaires: company.chiffre_affaires,
                code_naf: company.code_naf,
                libelle_code_naf: company.libelle_code_naf,
                ville: company.siege?.ville,
                code_postal: company.siege?.code_postal,
                region: company.siege?.region,
              },
            });

          if (insertError) {
            insertErrors++;
            console.error(`[fetch-pappers] Insert error siren=${company.siren} name=${company.denomination}:`, insertError.message ?? insertError);
          } else {
            signalsCreated++;
            inserted++;
          }
        }

        console.log(`[fetch-pappers] Page ${page} bilan → inserted=${inserted} dedup_skipped=${skippedDedup} ca_skipped=${skippedCa} insert_errors=${insertErrors}`);
        if (insertErrors > 0) {
          throw new Error(`Page Pappers ${page} incomplète: ${insertErrors} signal(aux) non persisté(s)`);
        }

        hasMore = companies.length === perPage && (page * perPage) < total;
        const nextYear = yearsToRun[yearIndex + 1];
        const nextCursor = pappersNextPageCursor({
          queryId,
          endpoint: 'recherche',
          page,
          scope,
          hasMore,
          nextScope: nextYear === undefined ? undefined : `anniversary:${nextYear}`,
        });

        // Le checkpoint de page désigne directement le prochain travail
        // logique. Un kill après la dernière page d'un scope ne peut donc pas
        // payer une page N+1 fictive.
        await run.recordPage({
          queryId,
          endpoint: 'recherche',
          page,
          returned: companies.length,
          total,
          totalPages: pappersPageCount(total, perPage),
          scope,
          nextCursor,
        });
        if (run.pageBudgetReached()) throw new PappersContinuationRequired();
        page++;
        
        // Pause pour éviter de surcharger l'API
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }

      } catch (error) {
        console.error(`[fetch-pappers] Error fetching anniversaries:`, error);
        throw error;
      }
    }
  }

  console.log(`[fetch-pappers] Total signaux créés pour anniversaires: ${signalsCreated}`);
  return signalsCreated;
}

// Les requêtes Publication historiques sont volontairement absentes de ce
// moteur : le contrat officiel ne fournit pas une identité société exploitable.
// `processQuery` les refuse avant tout appel HTTP.

// Entreprises récemment créées : endpoint /recherche avec date_creation_min sur
// les N derniers jours (parameters.recent_days, défaut 30). Score basé sur le
// scoring standard (effectif, CA, NAF).
async function searchCreations(query: PappersQuery, apiKey: string, supabase: any, run: PappersRun): Promise<number> {
  const { parameters, id: queryId } = query;
  const recentDays = parameters.recent_days ?? 30;
  const floors = await getPappersFloors(parameters, run.executionSettings);
  const dateMin = new Date(Date.parse(run.executionCapturedAt) - recentDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const scope = 'creations';
  const perPage = 50;
  let page = run.startPage(queryId, 'recherche', scope);
  let hasMore = true;
  let signalsCreated = 0;

  console.log(`[fetch-pappers] Recherche créations depuis ${formatDateForPappers(dateMin)} | region=${parameters.region ?? 'national'} | tranche_effectif_min=${floors.minEmployeesTranche ?? 'aucun'} | CA≥${floors.minRevenue}€`);
  while (hasMore) {
    const params = new URLSearchParams({
      api_token: apiKey,
      par_page: String(perPage),
      page: String(page),
      date_creation_min: formatDateForPappers(dateMin),
    });
    if (parameters.region && parameters.region !== 'all') params.append('region', parameters.region);
    if (floors.minEmployeesTranche) params.append('tranche_effectif_min', floors.minEmployeesTranche);

    try {
      const data = await pappersFetchJson<{
        resultats?: PappersCompany[];
        total?: number;
      }>(`https://api.pappers.fr/v2/recherche?${params.toString()}`, run, {
        queryId,
        endpoint: 'recherche',
        page,
        scope,
        maximumResults: perPage,
      });
      const companies: PappersCompany[] = data.resultats || [];
      const total = Number(data.total || companies.length);
      let insertErrors = 0;

      for (const company of companies) {
        // Filtre ICP (même règle que les anniversaires).
        if (!isIcpLegalForm(company.forme_juridique)) continue;

        const { data: existing } = await supabase
          .from('pappers_signals')
          .select('id')
          .eq('siren', company.siren)
          .eq('signal_type', 'creation')
          .maybeSingle();
        if (existing) continue;

        // Plancher CA (ICP premium) — même règle que les anniversaires.
        if (typeof company.chiffre_affaires === 'number' && company.chiffre_affaires > 0 && company.chiffre_affaires < floors.minRevenue) {
          continue;
        }

        const { error: insertError } = await supabase
          .from('pappers_signals')
          .insert({
            scan_id: run.scanId,
            query_id: queryId,
            company_name: company.denomination,
            siren: company.siren,
            signal_type: 'creation',
            signal_detail: `Entreprise créée le ${new Date(company.date_creation).toLocaleDateString('fr-FR')}`,
            relevance_score: capRelevanceForSmallCompany(
              { effectif: company.effectif || company.tranche_effectif, chiffre_affaires: company.chiffre_affaires, code_naf: company.code_naf },
              calculateRelevanceScore(company, parameters),
            ),
            company_data: {
              date_creation: company.date_creation,
              forme_juridique: company.forme_juridique,
              effectif: company.effectif,
            },
          });
        if (insertError) insertErrors++;
        else signalsCreated++;
      }

      if (insertErrors > 0) {
        throw new Error(`Page créations Pappers ${page} incomplète: ${insertErrors} signal(aux) non persisté(s)`);
      }
      hasMore = companies.length === perPage && page * perPage < total;
      const nextCursor = pappersNextPageCursor({
        queryId,
        endpoint: 'recherche',
        page,
        scope,
        hasMore,
      });
      await run.recordPage({
        queryId,
        endpoint: 'recherche',
        page,
        returned: companies.length,
        total,
        totalPages: pappersPageCount(total, perPage),
        scope,
        nextCursor,
      });
      if (run.pageBudgetReached()) throw new PappersContinuationRequired();
      page++;
      if (hasMore) await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      console.error(`[fetch-pappers] Error fetching creations:`, error);
      throw error;
    }
  }
  return signalsCreated;
}

// Bonus selon l'ampleur de l'anniversaire (plus c'est rond/ancien, plus l'occasion
// de cadeau est forte). Échelle calée pour qu'un centenaire ressorte au moins à 4★.
function milestoneBonus(years: number): number {
  if (years >= 100) return 35;
  if (years >= 50) return 30;
  if (years >= 25) return 22;
  if (years >= 20) return 18;
  if (years >= 10) return 12;
  return 6;
}

function calculateRelevanceScore(company: PappersCompany, parameters: any): number {
  let score = 50; // Base score
  score += pappersGeoPriorityBonus(company.siege?.region, parameters?.priority_regions);

  // Bonus for larger companies
  const effectif = company.effectif || company.tranche_effectif || '';
  if (effectif.includes('250') || effectif.includes('500') || effectif.includes('1000')) {
    score += 25;
  } else if (effectif.includes('100') || effectif.includes('200')) {
    score += 20;
  } else if (effectif.includes('50')) {
    score += 15;
  } else if (effectif.includes('20')) {
    score += 10;
  }

  // Bonus for revenue
  if (company.chiffre_affaires) {
    if (company.chiffre_affaires > 50000000) score += 20;
    else if (company.chiffre_affaires > 10000000) score += 15;
    else if (company.chiffre_affaires > 5000000) score += 10;
  }

  // Bonus for relevant sectors (luxury, food, events, etc.)
  const nafCode = company.code_naf || '';
  const relevantSectors = ['56', '47', '70', '82', '93']; // Restauration, commerce, conseil, services admin, loisirs
  if (relevantSectors.some(s => nafCode.startsWith(s))) {
    score += 10;
  }

  return Math.min(score, 100);
}

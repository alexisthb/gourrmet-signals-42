export const PAPPERS_RESULTS_PER_PAGE = 100;
// Fail closed: an absent or unreadable plan must never invent a 10k allowance.
export const PAPPERS_DEFAULT_MONTHLY_CREDITS = 0;
// Un worker ne traite qu'une page. Cinq minutes couvrent l'appel HTTP et la
// persistance sans laisser un handoff perdu bloqué pendant un quart d'heure.
export const PAPPERS_RUN_LEASE_SECONDS = 300;
export const PAPPERS_PAGES_PER_INVOCATION = 1;

export type PappersEndpoint = 'recherche' | 'publications' | 'entreprise';

export type PappersScanStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

export type PappersControlAction = 'start' | 'pause' | 'resume' | 'stop' | 'status' | 'daily' | 'recover';

export type PappersObservedScanStatus = PappersScanStatus | 'missing' | 'unknown';

export class PappersTransitionConflictError extends Error {
  readonly code = 'pappers_transition_conflict';

  constructor(
    public readonly action: Exclude<PappersControlAction, 'status'>,
    public readonly scanId: string | null,
    public readonly currentStatus: PappersObservedScanStatus,
  ) {
    super(`Transition Pappers ${action} refusée depuis l'état ${currentStatus}`);
    this.name = 'PappersTransitionConflictError';
  }
}

export function requirePappersMutation<T>(
  row: T | null | undefined,
  context: {
    action: Exclude<PappersControlAction, 'status'>;
    scanId: string | null;
    currentStatus: PappersObservedScanStatus;
  },
): T {
  if (!row) {
    throw new PappersTransitionConflictError(
      context.action,
      context.scanId,
      context.currentStatus,
    );
  }
  return row;
}

export function isPappersTransitionConflictCode(code: unknown): boolean {
  return code === '23505' || code === '55000';
}

export function parsePappersAction(value: unknown): PappersControlAction {
  const action = String(value ?? 'daily').toLowerCase();
  if (['start', 'pause', 'resume', 'stop', 'status', 'daily', 'recover'].includes(action)) {
    return action as PappersControlAction;
  }
  throw new Error(`Action Pappers inconnue: ${action}`);
}

export function isTerminalPappersStatus(status: string | null | undefined): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled';
}

export function transitionPappersStatus(
  current: PappersScanStatus,
  action: Extract<PappersControlAction, 'pause' | 'resume' | 'stop'>,
): PappersScanStatus {
  if (action === 'stop') {
    if (isTerminalPappersStatus(current)) throw new Error(`Le scan est déjà terminé (${current})`);
    return 'cancelled';
  }
  if (action === 'pause') {
    if (current !== 'pending' && current !== 'running') {
      throw new Error(`Impossible de mettre en pause un scan ${current}`);
    }
    return 'paused';
  }
  if (current !== 'paused' && current !== 'error') {
    throw new Error(`Impossible de reprendre un scan ${current}`);
  }
  return 'running';
}

/** priority 1 est la plus prioritaire ; 99 est la convention « standard ». */
export function isPriorityGeoZone(zone: { is_active?: boolean | null; priority?: number | null }): boolean {
  const priority = zone.priority ?? 99;
  return zone.is_active === true && priority > 0 && priority < 99;
}

export function formatDateForPappers(date: string): string {
  if (/^\d{2}-\d{2}-\d{4}$/.test(date)) return date;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : date;
}

export function employeesToPappersTranche(minEmployees: number): string | null {
  if (!Number.isFinite(minEmployees) || minEmployees <= 0) return null;
  const bands: Array<[number, string]> = [
    [10_000, '53'], [5_000, '52'], [2_000, '51'], [1_000, '42'], [500, '41'],
    [250, '32'], [200, '31'], [100, '22'], [50, '21'], [20, '12'], [10, '11'],
    [6, '03'], [3, '02'], [1, '01'],
  ];
  return bands.find(([minimum]) => minEmployees >= minimum)?.[1] ?? null;
}

/** Pappers facture 0,1 crédit par résultat de recherche retourné. */
export function pappersSearchCredits(resultCount: number): number {
  if (!Number.isFinite(resultCount) || resultCount <= 0) return 0;
  return Math.round(resultCount) / 10;
}

export function pappersReservedCredits(endpoint: PappersEndpoint, maximumResults: number): number {
  return endpoint === 'entreprise' ? 1 : pappersSearchCredits(maximumResults);
}

export function pappersActualCredits(endpoint: PappersEndpoint, returnedResults: number): number {
  return endpoint === 'entreprise' ? 1 : pappersSearchCredits(returnedResults);
}

/**
 * Une tentative logique garde la même clé après un crash. Une nouvelle clé ne
 * peut être créée qu'en incrémentant explicitement `attempt`, après résolution
 * de l'ambiguïté fournisseur.
 */
export function pappersAttemptRequestKey(input: {
  scanId: string;
  queryId: string;
  endpoint: PappersEndpoint;
  scope: string;
  page: number;
  attempt: number;
}): string {
  const scope = encodeURIComponent(input.scope || 'default');
  return `scan:${input.scanId}:query:${input.queryId}:${input.endpoint}:${scope}:page:${input.page}:attempt:${input.attempt}`;
}

export type PappersStoredRequestDecision =
  | 'new'
  | 'prepared'
  | 'cached'
  | 'ambiguous'
  | 'terminal_failure';

export function classifyPappersStoredRequest(input: {
  reservationStatus?: string | null;
  success?: boolean | null;
  dispatchState?: string | null;
  hasCachedPayload?: boolean;
} | null): PappersStoredRequestDecision {
  if (!input) return 'new';
  if (input.reservationStatus === 'completed' && input.success === true) {
    return input.hasCachedPayload ? 'cached' : 'ambiguous';
  }
  if (input.reservationStatus === 'completed') return 'terminal_failure';
  if (input.reservationStatus === 'reserved' && input.dispatchState === 'prepared') {
    return 'prepared';
  }
  return 'ambiguous';
}

export interface PappersDurableCursor {
  query_id: string;
  endpoint: PappersEndpoint | 'control';
  page: number;
  scope: string;
  attempt: 0;
}

/**
 * Le checkpoint de page pointe toujours vers le prochain travail réel. Sur la
 * dernière page, il bascule vers le scope suivant ou vers `query_complete` ;
 * il ne fabrique jamais une page N+1 qui pourrait être repayée au recovery.
 */
export function pappersNextPageCursor(input: {
  queryId: string;
  endpoint: Extract<PappersEndpoint, 'recherche' | 'publications'>;
  page: number;
  scope: string;
  hasMore: boolean;
  nextScope?: string;
}): PappersDurableCursor {
  if (input.hasMore) {
    return {
      query_id: input.queryId,
      endpoint: input.endpoint,
      page: input.page + 1,
      scope: input.scope,
      attempt: 0,
    };
  }
  if (input.nextScope) {
    return {
      query_id: input.queryId,
      endpoint: input.endpoint,
      page: 1,
      scope: input.nextScope,
      attempt: 0,
    };
  }
  return {
    query_id: input.queryId,
    endpoint: 'control',
    page: 1,
    scope: 'query_complete',
    attempt: 0,
  };
}

export function assertPappersBudget(input: {
  used: number;
  limit: number;
  reserved?: number;
}): void {
  const reserved = input.reserved ?? pappersSearchCredits(PAPPERS_RESULTS_PER_PAGE);
  if (input.limit <= 0 || input.used + reserved > input.limit) {
    throw new Error(`Quota Pappers insuffisant: ${input.used}/${input.limit}, prochain appel ${reserved} crédits`);
  }
}

export function pappersPageCount(total: number, perPage = PAPPERS_RESULTS_PER_PAGE): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / Math.max(1, perPage));
}

export function pappersGeoPriorityBonus(companyRegion: unknown, priorityRegions: unknown): number {
  if (typeof companyRegion !== 'string' || !Array.isArray(priorityRegions)) return 0;
  const normalized = companyRegion.trim().toLocaleLowerCase('fr');
  return priorityRegions.some((region) =>
    typeof region === 'string' && region.trim().toLocaleLowerCase('fr') === normalized
  ) ? 10 : 0;
}

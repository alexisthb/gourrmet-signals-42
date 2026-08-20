import {
  assertPappersBudget,
  classifyPappersStoredRequest,
  employeesToPappersTranche,
  formatDateForPappers,
  isPriorityGeoZone,
  pappersPageCount,
  pappersActualCredits,
  pappersAttemptRequestKey,
  pappersGeoPriorityBonus,
  pappersNextPageCursor,
  pappersReservedCredits,
  pappersSearchCredits,
  parsePappersAction,
  PAPPERS_DEFAULT_MONTHLY_CREDITS,
  PAPPERS_PAGES_PER_INVOCATION,
  PappersTransitionConflictError,
  requirePappersMutation,
  isPappersTransitionConflictCode,
  transitionPappersStatus,
} from './pappers-engine.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('les zones standard priority=99 ne sont pas prioritaires', () => {
  assertEquals(isPriorityGeoZone({ is_active: true, priority: 99 }), false);
  assertEquals(isPriorityGeoZone({ is_active: true, priority: 1 }), true);
  assertEquals(isPriorityGeoZone({ is_active: false, priority: 1 }), false);
});

Deno.test('une géozone configurée priorise sans exclure les autres régions', () => {
  assertEquals(pappersGeoPriorityBonus('Bretagne', ['Bretagne']), 10);
  assertEquals(pappersGeoPriorityBonus('Normandie', ['Bretagne']), 0);
});

Deno.test('les actions de contrôle refusent les transitions fictives', () => {
  assertEquals(transitionPappersStatus('running', 'pause'), 'paused');
  assertEquals(transitionPappersStatus('paused', 'resume'), 'running');
  assertEquals(transitionPappersStatus('running', 'stop'), 'cancelled');
  let rejected = false;
  try { transitionPappersStatus('completed', 'pause'); } catch { rejected = true; }
  assertEquals(rejected, true);
});

Deno.test('le routeur reconnaît toutes les actions Pappers et refuse les autres', () => {
  for (const action of ['start', 'pause', 'resume', 'stop', 'status', 'daily', 'recover']) {
    assertEquals(parsePappersAction(action), action);
  }
  assertEquals(parsePappersAction(undefined), 'daily');
  let rejected = false;
  try { parsePappersAction('restart'); } catch { rejected = true; }
  assertEquals(rejected, true);
});

Deno.test('une mutation conditionnelle Pappers sans ligne devient un conflit explicite', () => {
  const persisted = requirePappersMutation(
    { id: 'scan-1', status: 'paused' },
    { action: 'pause', scanId: 'scan-1', currentStatus: 'running' },
  );
  assertEquals(persisted.status, 'paused');

  let conflict: PappersTransitionConflictError | null = null;
  try {
    requirePappersMutation(null, {
      action: 'pause',
      scanId: 'scan-1',
      currentStatus: 'cancelled',
    });
  } catch (error) {
    if (error instanceof PappersTransitionConflictError) conflict = error;
  }
  assertEquals(conflict?.code, 'pappers_transition_conflict');
  assertEquals(conflict?.action, 'pause');
  assertEquals(conflict?.scanId, 'scan-1');
  assertEquals(conflict?.currentStatus, 'cancelled');
  assertEquals(isPappersTransitionConflictCode('55000'), true);
  assertEquals(isPappersTransitionConflictCode('23505'), true);
  assertEquals(isPappersTransitionConflictCode('42501'), false);
});

Deno.test('dates, tranches, pagination et crédits suivent le contrat Pappers', () => {
  assertEquals(formatDateForPappers('2026-08-20'), '20-08-2026');
  assertEquals(employeesToPappersTranche(20), '12');
  assertEquals(employeesToPappersTranche(250), '32');
  assertEquals(pappersPageCount(201), 3);
  assertEquals(pappersSearchCredits(100), 10);
  assertEquals(pappersSearchCredits(11), 1.1);
  assertEquals(pappersSearchCredits(1), 0.1);
});

Deno.test('le moteur bloque avant de dépasser le quota', () => {
  assertPappersBudget({ used: 90, limit: 100, reserved: 10 });
  let rejected = false;
  try { assertPappersBudget({ used: 91, limit: 100, reserved: 10 }); } catch { rejected = true; }
  assertEquals(rejected, true);
});

Deno.test('le quota Pappers échoue fermé et distingue réservation du coût réel', () => {
  assertEquals(PAPPERS_DEFAULT_MONTHLY_CREDITS, 0);
  assertEquals(pappersReservedCredits('recherche', 100), 10);
  assertEquals(pappersActualCredits('recherche', 11), 1.1);
  assertEquals(pappersReservedCredits('entreprise', 100), 1);
  assertEquals(pappersActualCredits('entreprise', 0), 1);
});

Deno.test('la clé Pappers est stable au replay et distincte seulement après retry explicite', () => {
  const base = {
    scanId: 'scan-1', queryId: 'query-1', endpoint: 'publications' as const,
    scope: 'nominations/France', page: 1,
  };
  const first = pappersAttemptRequestKey({ ...base, attempt: 0 });
  const retry = pappersAttemptRequestKey({ ...base, attempt: 1 });
  const replayedPage = pappersAttemptRequestKey({ ...base, attempt: 0 });
  assertEquals(first === retry, false);
  assertEquals(first, replayedPage);
  assertEquals(first, pappersAttemptRequestKey({ ...base, attempt: 0 }));
});

Deno.test('un appel payé est rejoué depuis cache et un appel dispatché reste bloqué', () => {
  assertEquals(classifyPappersStoredRequest(null), 'new');
  assertEquals(classifyPappersStoredRequest({
    reservationStatus: 'reserved', dispatchState: 'prepared',
  }), 'prepared');
  assertEquals(classifyPappersStoredRequest({
    reservationStatus: 'completed', success: true, hasCachedPayload: true,
  }), 'cached');
  assertEquals(classifyPappersStoredRequest({
    reservationStatus: 'completed', success: true, hasCachedPayload: false,
  }), 'ambiguous');
  assertEquals(classifyPappersStoredRequest({
    reservationStatus: 'reserved', dispatchState: 'dispatched',
  }), 'ambiguous');
  assertEquals(classifyPappersStoredRequest({
    reservationStatus: 'uncertain', dispatchState: 'ambiguous',
  }), 'ambiguous');
});

Deno.test('chaque invocation traite une page et checkpoint le prochain travail réel', () => {
  assertEquals(PAPPERS_PAGES_PER_INVOCATION, 1);
  assertEquals(pappersNextPageCursor({
    queryId: 'query-1', endpoint: 'recherche', page: 2,
    scope: 'anniversary:10', hasMore: true,
  }), {
    query_id: 'query-1', endpoint: 'recherche', page: 3,
    scope: 'anniversary:10', attempt: 0,
  });
  assertEquals(pappersNextPageCursor({
    queryId: 'query-1', endpoint: 'recherche', page: 3,
    scope: 'anniversary:10', hasMore: false, nextScope: 'anniversary:20',
  }), {
    query_id: 'query-1', endpoint: 'recherche', page: 1,
    scope: 'anniversary:20', attempt: 0,
  });
  assertEquals(pappersNextPageCursor({
    queryId: 'query-1', endpoint: 'recherche', page: 3,
    scope: 'anniversary:20', hasMore: false,
  }), {
    query_id: 'query-1', endpoint: 'control', page: 1,
    scope: 'query_complete', attempt: 0,
  });
});

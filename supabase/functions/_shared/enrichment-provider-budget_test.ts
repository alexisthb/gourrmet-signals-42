import {
  apifyActorOperationKey,
  classifyEnrichmentInvocation,
  decideApifyActorRunRecovery,
  decidePappersCompanyRecovery,
  decideProviderDatasetRead,
  decideProviderTaskRecovery,
  decideWaterfallProviderRecovery,
  enrichmentBusinessOperationKey,
  enrichmentProviderAttemptKey,
  evaluateCreditBudget,
  pappersCompanyOperationKey,
  parseEnrichmentDispatchIdentity,
  operationGenerationFromRawData,
  parseEnrichmentProviderRoute,
  shouldContinueDropcontactPolling,
} from "./enrichment-provider-budget.ts";

function assertEquals(actual: unknown, expected: unknown, message?: string) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(message ?? `Expected ${right}, received ${left}`);
}

Deno.test("un plan Pappers absent, nul, perime ou epuise bloque avant l'appel", () => {
  assertEquals(evaluateCreditBudget(null, 0, 1, "2026-08-20").allowed, false);
  assertEquals(evaluateCreditBudget({ monthly_credits: 0, current_period_start: "2026-08-01", current_period_end: "2026-08-31" }, 0, 1, "2026-08-20").reason, "plan_zero");
  assertEquals(evaluateCreditBudget({ monthly_credits: 10, current_period_start: "2026-07-01", current_period_end: "2026-07-31" }, 0, 1, "2026-08-20").reason, "period_not_current");
  assertEquals(evaluateCreditBudget({ monthly_credits: 10, current_period_start: "2026-08-01", current_period_end: "2026-08-31" }, 10, 1, "2026-08-20").reason, "plan_exhausted");
});

Deno.test("le preflight expose le solde sans pretendre reserver le credit", () => {
  assertEquals(
    evaluateCreditBudget(
      { monthly_credits: 10, current_period_start: "2026-08-01", current_period_end: "2026-08-31" },
      7,
      1,
      "2026-08-20",
    ),
    { allowed: true, reason: "ok", limit: 10, used: 7, remaining_before: 3, remaining_after: 2 },
  );
});

Deno.test("un 2xx skipped ou success false reste retryable et ne devient jamais completed", () => {
  assertEquals(
    classifyEnrichmentInvocation(true, { success: false, reason: "no_candidates" }),
    { kind: "retry", reason: "no_candidates", externalTaskId: null },
  );
  assertEquals(
    classifyEnrichmentInvocation(true, { success: true, skipped: true, reason: "gate_disabled" }),
    { kind: "retry", reason: "gate_disabled", externalTaskId: null },
  );
});

Deno.test("seul un succes explicite termine; une soumission asynchrone reste running", () => {
  assertEquals(
    classifyEnrichmentInvocation(true, { success: true, contacts_inserted: 2 }),
    { kind: "completed", reason: null, externalTaskId: null },
  );
  assertEquals(
    classifyEnrichmentInvocation(true, { success: true, apify_run_id: "run-123" }),
    { kind: "running", reason: null, externalTaskId: "run-123" },
  );
  assertEquals(
    classifyEnrichmentInvocation(true, { success: true, already_running: true }),
    { kind: "running", reason: "already_running", externalTaskId: null },
  );
  assertEquals(
    classifyEnrichmentInvocation(true, { message: "ambiguous 2xx" }),
    { kind: "retry", reason: "missing_success_confirmation", externalTaskId: null },
  );
});

Deno.test("les providers rejouables gardent une cle par tentative et une idempotence metier stable", () => {
  const businessKey = enrichmentBusinessOperationKey("enr-1", "linkedin-contacts-v1");
  const firstAttempt = enrichmentProviderAttemptKey("enr-1", "apify", "linkedin_employee_submit", "attempt-1");
  const retryAttempt = enrichmentProviderAttemptKey("enr-1", "apify", "linkedin_employee_submit", "attempt-2");

  assertEquals(businessKey, "enrichment:enr-1:linkedin-contacts-v1");
  assertEquals(firstAttempt, "enrichment:enr-1:apify:linkedin_employee_submit:attempt-1");
  assertEquals(retryAttempt, "enrichment:enr-1:apify:linkedin_employee_submit:attempt-2");
  if (firstAttempt === retryAttempt) throw new Error("A provider retry reused the previous request key");
});

Deno.test("Pappers entreprise garde la meme cle logique sur chaque reprise", () => {
  const first = pappersCompanyOperationKey("enr-1");
  const retry = pappersCompanyOperationKey("enr-1");
  assertEquals(first, "enrichment:enr-1:pappers:entreprise-v1");
  assertEquals(retry, first);
});

Deno.test("Apify garde une cle logique stable par actor run", () => {
  assertEquals(
    apifyActorOperationKey("enr-1", "linkedin_company_search"),
    "enrichment:enr-1:apify:linkedin_company_search-v1",
  );
  assertEquals(
    apifyActorOperationKey("enr-1", "linkedin_employee_submit"),
    "enrichment:enr-1:apify:linkedin_employee_submit-v1",
  );
});

Deno.test("une reprise de lease garde la generation fournisseur du job", () => {
  const first = parseEnrichmentDispatchIdentity({
    accepted: true,
    already_completed: false,
    enrichment_id: "enrichment-1",
    operation_generation: "job-1",
    generation_started: true,
    raw_data: { operation_generation: "job-1" },
  });
  const reclaim = parseEnrichmentDispatchIdentity({
    accepted: true,
    already_completed: false,
    enrichment_id: "enrichment-1",
    operation_generation: "job-1",
    generation_started: false,
    raw_data: { operation_generation: "job-1", apify_run_id: "run-1" },
  });
  assertEquals(first?.operationGeneration, "job-1");
  assertEquals(reclaim?.operationGeneration, first?.operationGeneration);
  assertEquals(
    apifyActorOperationKey(reclaim!.operationGeneration, "linkedin_employee_submit"),
    apifyActorOperationKey(first!.operationGeneration, "linkedin_employee_submit"),
  );
});

Deno.test("un nouvel essai terminal autorise recoit de nouvelles cles Pappers et Apify", () => {
  const first = parseEnrichmentDispatchIdentity({
    accepted: true,
    already_completed: false,
    enrichment_id: "enrichment-1",
    operation_generation: "job-1",
    generation_started: true,
    raw_data: { operation_generation: "job-1" },
  })!;
  const explicitRetry = parseEnrichmentDispatchIdentity({
    accepted: true,
    already_completed: false,
    enrichment_id: "enrichment-1",
    operation_generation: "job-2",
    generation_started: true,
    raw_data: {
      operation_generation: "job-2",
      previous_operation_generation: "job-1",
    },
  })!;
  if (
    pappersCompanyOperationKey(first.operationGeneration) ===
      pappersCompanyOperationKey(explicitRetry.operationGeneration)
  ) throw new Error("Le retry explicite a reutilise la cle Pappers terminale");
  if (
    apifyActorOperationKey(first.operationGeneration, "linkedin_employee_submit") ===
      apifyActorOperationKey(explicitRetry.operationGeneration, "linkedin_employee_submit")
  ) throw new Error("Le retry explicite a reutilise la cle Apify terminale");
});

Deno.test("un dispatch sans generation durable est refuse ferme", () => {
  assertEquals(parseEnrichmentDispatchIdentity({
    accepted: true,
    enrichment_id: "enrichment-1",
  }), null);
  assertEquals(parseEnrichmentDispatchIdentity({
    accepted: false,
    enrichment_id: "enrichment-1",
    operation_generation: "job-1",
  }), null);
});

Deno.test("le poller exige la generation brute et ne devine jamais company_enrichment.id", () => {
  assertEquals(operationGenerationFromRawData({ operation_generation: "job-2" }), "job-2");
  assertEquals(operationGenerationFromRawData({ queue_claim: { job_id: "job-2" } }), null);
  assertEquals(operationGenerationFromRawData(null), null);
});

Deno.test("une route provider liee est strictement bornee", () => {
  assertEquals(parseEnrichmentProviderRoute("linkedin"), "linkedin");
  assertEquals(parseEnrichmentProviderRoute("waterfall"), "waterfall");
  assertEquals(parseEnrichmentProviderRoute("manus"), null);
  assertEquals(parseEnrichmentProviderRoute(null), null);
});

Deno.test("Apify reserve une premiere run et reprend une reservation seulement preparee", () => {
  const requestKey = apifyActorOperationKey("enr-1", "linkedin_company_search");
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey,
      localRequestKey: null,
      localReservationId: null,
      localStage: null,
      localProviderTaskId: null,
      hasCachedResult: false,
      reservationRows: [],
      providerLedgerRows: [],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "reserve",
      reservationId: null,
      providerTaskId: null,
      reason: "no_prior_operation",
    },
  );
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey,
      localRequestKey: requestKey,
      localReservationId: "quota-1",
      localStage: "intent",
      localProviderTaskId: null,
      hasCachedResult: false,
      reservationRows: [{
        id: "quota-1",
        request_key: requestKey,
        status: "reserved",
        metadata: { dispatch_state: "prepared" },
      }],
      providerLedgerRows: [],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "dispatch",
      reservationId: "quota-1",
      providerTaskId: null,
      reason: "prepared_reservation",
    },
  );
});

Deno.test("Apify bloque une run marquee dispatched sans preuve fournisseur", () => {
  const requestKey = apifyActorOperationKey("enr-1", "linkedin_employee_submit");
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey,
      localRequestKey: requestKey,
      localReservationId: "quota-1",
      localStage: "dispatched",
      localProviderTaskId: null,
      hasCachedResult: false,
      reservationRows: [{
        id: "quota-1",
        request_key: requestKey,
        status: "reserved",
        metadata: { dispatch_state: "dispatched" },
      }],
      providerLedgerRows: [],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "blocked",
      reservationId: "quota-1",
      providerTaskId: null,
      reason: "provider_outcome_uncertain",
    },
  );
});

Deno.test("Apify finalise depuis un cache ou un run ledger sans resoumettre", () => {
  const companyKey = apifyActorOperationKey("enr-1", "linkedin_company_search");
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey: companyKey,
      localRequestKey: companyKey,
      localReservationId: "quota-company",
      localStage: "response_cached",
      localProviderTaskId: null,
      hasCachedResult: true,
      reservationRows: [{
        id: "quota-company",
        request_key: companyKey,
        status: "reserved",
        metadata: { dispatch_state: "dispatched" },
      }],
      providerLedgerRows: [],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "finalize_and_reuse",
      reservationId: "quota-company",
      providerTaskId: null,
      reason: "durable_provider_proof",
    },
  );

  const employeeKey = apifyActorOperationKey("enr-1", "linkedin_employee_submit");
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey: employeeKey,
      localRequestKey: null,
      localReservationId: null,
      localStage: null,
      localProviderTaskId: null,
      hasCachedResult: false,
      reservationRows: [],
      providerLedgerRows: [{ metadata: { provider_request_id: "run-1" } }],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "reuse_legacy",
      reservationId: null,
      providerTaskId: "run-1",
      reason: "legacy_provider_proof",
    },
  );
});

Deno.test("Apify finalise un echec terminal cache meme si le ledger n'a pas de runId", () => {
  const requestKey = apifyActorOperationKey("enr-1", "linkedin_employee_submit");
  assertEquals(
    decideApifyActorRunRecovery({
      requestKey,
      localRequestKey: requestKey,
      localReservationId: "quota-employee",
      localStage: "response_cached",
      localProviderTaskId: null,
      hasCachedResult: true,
      reservationRows: [{
        id: "quota-employee",
        request_key: requestKey,
        status: "reserved",
        metadata: { dispatch_state: "dispatched" },
      }],
      providerLedgerRows: [{ metadata: { provider_request_id: null }, success: false }],
      allowLegacyProviderProof: true,
    }),
    {
      kind: "finalize_and_reuse",
      reservationId: "quota-employee",
      providerTaskId: null,
      reason: "durable_provider_proof",
    },
  );
});

Deno.test("Pappers peut reserver apres une intention durable sans reservation", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  assertEquals(
    decidePappersCompanyRecovery({ requestKey, rawData: {}, reservationRows: [] }),
    {
      kind: "reserve_and_call",
      usageId: null,
      reservationStatus: null,
      cachedResponse: null,
      reason: "no_prior_operation",
    },
  );
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_intent",
        pappers_request_key: requestKey,
      },
      reservationRows: [],
    }),
    {
      kind: "reserve_and_call",
      usageId: null,
      reservationStatus: null,
      cachedResponse: null,
      reason: "durable_intent_without_reservation",
    },
  );
});

Deno.test("waterfall reconnait les checkpoints Pappers avant Dropcontact", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  assertEquals(
    decideWaterfallProviderRecovery({
      source: "waterfall",
      waterfall_stage: "pappers_response_cached",
      pappers_request_key: requestKey,
      pappers_usage_id: "usage-1",
      pappers_response_cache: {
        request_key: requestKey,
        usage_id: "usage-1",
        success: true,
        http_status: 200,
        error_code: null,
        payload: { siren: "123456789" },
      },
    }, []),
    { kind: "start_pappers", taskId: null, reason: "durable_pappers_stage" },
  );
});

Deno.test("Pappers bloque la kill-window apres reservation sans reponse durable", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_calling",
        pappers_request_key: requestKey,
        pappers_usage_id: "usage-1",
      },
      reservationRows: [{
        id: "usage-1",
        request_key: requestKey,
        reservation_status: "reserved",
      }],
    }),
    {
      kind: "blocked",
      usageId: "usage-1",
      reservationStatus: "reserved",
      cachedResponse: null,
      reason: "provider_outcome_uncertain",
    },
  );
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {},
      reservationRows: [{
        id: "usage-1",
        request_key: requestKey,
        reservation_status: "uncertain",
      }],
    }).kind,
    "blocked",
  );
});

Deno.test("Pappers reprend le cache coherent sans nouvel appel fournisseur", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  const cache = {
    request_key: requestKey,
    usage_id: "usage-1",
    success: true,
    http_status: 200,
    error_code: null,
    payload: { siren: "123456789" },
  };
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_response_cached",
        pappers_request_key: requestKey,
        pappers_usage_id: "usage-1",
        pappers_response_cache: cache,
      },
      reservationRows: [{
        id: "usage-1",
        request_key: requestKey,
        reservation_status: "reserved",
      }],
    }),
    {
      kind: "reuse_cached_response",
      usageId: "usage-1",
      reservationStatus: "reserved",
      cachedResponse: cache,
      reason: "matching_cached_response",
    },
  );
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_response_cached",
        pappers_request_key: requestKey,
        pappers_usage_id: "usage-1",
        pappers_response_cache: cache,
      },
      reservationRows: [{
        id: "usage-1",
        request_key: requestKey,
        reservation_status: "completed",
        success: true,
      }],
    }).kind,
    "reuse_cached_response",
  );
});

Deno.test("Pappers bloque un cache incoherent avec la finalisation comptable", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_response_cached",
        pappers_request_key: requestKey,
        pappers_usage_id: "usage-1",
        pappers_response_cache: {
          request_key: requestKey,
          usage_id: "usage-1",
          success: true,
          http_status: 200,
          error_code: null,
          payload: { siren: "123456789" },
        },
      },
      reservationRows: [{
        id: "usage-1",
        request_key: requestKey,
        reservation_status: "uncertain",
        success: false,
      }],
    }).kind,
    "blocked",
  );
});

Deno.test("Pappers echoue ferme si la preuve locale et le ledger divergent", () => {
  const requestKey = pappersCompanyOperationKey("enr-1");
  assertEquals(
    decidePappersCompanyRecovery({
      requestKey,
      rawData: {
        source: "waterfall",
        waterfall_stage: "pappers_response_cached",
        pappers_request_key: requestKey,
        pappers_usage_id: "usage-local",
        pappers_response_cache: {
          request_key: requestKey,
          usage_id: "usage-local",
          success: true,
          http_status: 200,
          error_code: null,
          payload: { siren: "123456789" },
        },
      },
      reservationRows: [{
        id: "usage-ledger",
        request_key: requestKey,
        reservation_status: "completed",
      }],
    }).kind,
    "blocked",
  );
});

Deno.test("la reprise reutilise une preuve fournisseur locale ou ledger coherente sans limite d'age", () => {
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: "run-1",
      priorLedgerRows: [{ metadata: { provider_request_id: "run-1" } }],
      isRetry: true,
    }),
    { kind: "reuse", taskId: "run-1", reason: "local_and_ledger" },
  );
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: null,
      priorLedgerRows: [{
        success: false,
        metadata: { provider_request_id: "run-from-ledger" },
      }],
      isRetry: true,
    }),
    { kind: "reuse", taskId: "run-from-ledger", reason: "ledger" },
  );
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: "run-local-only",
      priorLedgerRows: [],
      isRetry: true,
    }),
    { kind: "reuse", taskId: "run-local-only", reason: "local" },
  );
});

Deno.test("une reprise sans preuve ou avec des identifiants ambigus echoue fermee", () => {
  assertEquals(
    decideProviderTaskRecovery({ localTaskId: null, priorLedgerRows: [], isRetry: true }),
    { kind: "blocked", taskId: null, reason: "retry_without_provider_proof" },
  );
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: null,
      priorLedgerRows: [{ metadata: {} }],
      isRetry: true,
    }),
    { kind: "blocked", taskId: null, reason: "ledger_task_id_missing" },
  );
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: "local-run",
      priorLedgerRows: [{ metadata: { provider_request_id: "ledger-run" } }],
      isRetry: true,
    }),
    { kind: "blocked", taskId: null, reason: "conflicting_task_ids" },
  );
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: null,
      priorLedgerRows: [
        { metadata: { provider_request_id: "run-1" } },
        { metadata: { provider_request_id: "run-2" } },
      ],
      isRetry: true,
    }),
    { kind: "blocked", taskId: null, reason: "multiple_provider_tasks" },
  );
});

Deno.test("une intention Dropcontact non confirmee sans request_id bloque toute resoumission", () => {
  assertEquals(
    decideProviderTaskRecovery({
      localTaskId: null,
      priorLedgerRows: [{
        dispatch_status: "unconfirmed",
        business_key: "enrichment:enr-1:dropcontact-enrich-v1",
        metadata: { provider_request_id: null },
      }],
      isRetry: true,
    }),
    { kind: "blocked", taskId: null, reason: "ledger_task_id_missing" },
  );
});

Deno.test("seule une premiere execution sans aucune preuve peut soumettre", () => {
  assertEquals(
    decideProviderTaskRecovery({ localTaskId: null, priorLedgerRows: [], isRetry: false }),
    { kind: "submit", taskId: null, reason: "no_prior_task" },
  );
});

Deno.test("waterfall reprend Dropcontact avant tout nouvel appel Pappers", () => {
  assertEquals(
    decideWaterfallProviderRecovery({}, []),
    { kind: "start_pappers", taskId: null, reason: "no_durable_waterfall_stage" },
  );
  const ready = {
    source: "waterfall",
    waterfall_stage: "dropcontact_ready",
    candidates: [{ dropcontact_candidate_id: "enr-1:0", first_name: "Ada" }],
  };
  assertEquals(
    decideWaterfallProviderRecovery(ready, []),
    { kind: "submit_dropcontact", taskId: null, reason: "durable_candidates_ready" },
  );
  assertEquals(
    decideWaterfallProviderRecovery(ready, [{ metadata: { provider_request_id: "dc-1" } }]),
    { kind: "poll_dropcontact", taskId: "dc-1", reason: "ledger" },
  );
  assertEquals(
    decideWaterfallProviderRecovery({
      ...ready,
      waterfall_stage: "dropcontact_processing",
      dropcontact_request_id: "dc-1",
    }, [{ metadata: { provider_request_id: "dc-1" } }]),
    { kind: "poll_dropcontact", taskId: "dc-1", reason: "local_and_ledger" },
  );
});

Deno.test("waterfall bloque une reprise ambigue sans rejouer Pappers", () => {
  const processing = {
    source: "waterfall",
    waterfall_stage: "dropcontact_processing",
    candidates: [{ dropcontact_candidate_id: "enr-1:0" }],
  };
  assertEquals(
    decideWaterfallProviderRecovery(processing, []),
    { kind: "blocked", taskId: null, reason: "retry_without_provider_proof" },
  );
  assertEquals(
    decideWaterfallProviderRecovery({}, [{ metadata: { provider_request_id: "dc-orphan" } }]),
    { kind: "blocked", taskId: null, reason: "provider_proof_without_candidates" },
  );
});

Deno.test("un dataset Apify journalise est relu seulement avec le meme identifiant", () => {
  assertEquals(
    decideProviderDatasetRead("dataset-1", []),
    { kind: "fetch_dataset", datasetId: "dataset-1", reason: "first_read" },
  );
  assertEquals(
    decideProviderDatasetRead("dataset-1", [{
      metadata: { provider_request_id: "dataset-1" },
    }]),
    { kind: "fetch_dataset", datasetId: "dataset-1", reason: "replay_same_dataset" },
  );
  assertEquals(
    decideProviderDatasetRead("dataset-1", [{
      metadata: { provider_request_id: "dataset-2" },
    }]),
    { kind: "blocked", datasetId: null, reason: "conflicting_task_ids" },
  );
  assertEquals(
    decideProviderDatasetRead("dataset-1", [{ metadata: {} }]),
    { kind: "blocked", datasetId: null, reason: "ledger_task_id_missing" },
  );
});

Deno.test("un timeout local Dropcontact ne termine jamais un lot fournisseur", () => {
  assertEquals(shouldContinueDropcontactPolling(false), true);
  assertEquals(shouldContinueDropcontactPolling(true), false);
});

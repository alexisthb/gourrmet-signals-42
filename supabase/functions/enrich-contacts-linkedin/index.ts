import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  chooseCompanySearchQuery,
  parsePersonasSetting,
  resolveScraperMode,
  resolveCompanyLinkedInUrl,
  submitCompanyEmployeesRun,
  type ApifyCallUsage,
  type CompanyResolution,
} from "../_shared/apify-linkedin.ts";
import {
  apifyActorOperationKey,
  decideApifyActorRunRecovery,
  enrichmentBusinessOperationKey,
  parseEnrichmentDispatchIdentity,
} from "../_shared/enrichment-provider-budget.ts";

interface EnrichmentQueueClaim {
  job_id: string;
  lease_token: string;
}

async function beginEnrichmentDispatch(
  supabase: any,
  claim: EnrichmentQueueClaim,
  signalId: string,
  companyName: string,
): Promise<{
  enrichmentId: string;
  operationGeneration: string;
  alreadyCompleted: boolean;
  rawData: Record<string, unknown>;
}> {
  const { data, error } = await supabase.rpc("begin_enrichment_dispatch", {
    p_job_id: claim.job_id,
    p_lease_token: claim.lease_token,
    p_signal_id: signalId,
    p_company_name: companyName,
    p_enrichment_source: "linkedin",
  });
  if (error) throw new Error(`begin LinkedIn dispatch: ${error.message}`);
  const identity = parseEnrichmentDispatchIdentity(data);
  if (!identity) {
    throw new Error(`dispatch_fence_lost:${claim.job_id}`);
  }
  return {
    enrichmentId: identity.enrichmentId,
    operationGeneration: identity.operationGeneration,
    alreadyCompleted: identity.alreadyCompleted,
    rawData: identity.rawData,
  };
}

async function updateEnrichmentDispatch(
  supabase: any,
  claim: EnrichmentQueueClaim,
  enrichmentId: string,
  companyPatch: Record<string, unknown>,
  signalStatus: "pending" | "processing" | "completed" | "failed" | null,
  expectedStatus: string | null = null,
): Promise<void> {
  const { data, error } = await supabase.rpc("update_enrichment_dispatch", {
    p_job_id: claim.job_id,
    p_lease_token: claim.lease_token,
    p_enrichment_id: enrichmentId,
    p_company_patch: companyPatch,
    p_signal_status: signalStatus,
    p_expected_status: expectedStatus,
  });
  if (error) throw new Error(`update LinkedIn dispatch: ${error.message}`);
  if (data !== true) throw new Error(`dispatch_fence_lost:${claim.job_id}`);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function durableCompanyResolution(value: unknown): CompanyResolution | null {
  const resolution = recordValue(value);
  const provenance = recordValue(resolution?.provenance);
  if (
    !resolution || !provenance || provenance.provider !== "apify" ||
    !["resolved", "ambiguous", "rejected"].includes(String(resolution.status || ""))
  ) return null;
  return resolution as unknown as CompanyResolution;
}

async function reserveApifyActorRun(
  supabase: any,
  input: {
    requestKey: string;
    operation: "linkedin_company_search" | "linkedin_employee_submit";
    enrichmentId: string;
    signalId: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("reserve_apify_actor_run", {
    p_request_key: input.requestKey,
    p_operation: input.operation,
    p_run_id: input.enrichmentId,
    p_signal_id: input.signalId,
    p_metadata: { source: "contact_enrichment" },
  });
  if (error) throw new Error(`Quota Apify refusé: ${error.message}`);
  if (data?.allowed !== true || typeof data?.reservation_id !== "string") {
    throw new Error(`Quota Apify refusé: ${String(data?.reason || "reservation_absente")}`);
  }
  return data.reservation_id;
}

async function markApifyActorRunDispatched(
  supabase: any,
  requestKey: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("mark_apify_actor_run_dispatched", {
    p_request_key: requestKey,
  });
  if (error) throw new Error(`Dispatch Apify non confirmé: ${error.message}`);
  if (data !== true) {
    throw new Error("Dispatch Apify déjà consommé ou preuve ambiguë");
  }
}

async function completeApifyActorRun(
  supabase: any,
  input: {
    requestKey: string;
    success: boolean;
    providerRequestId: string | null;
    httpStatus: number | null;
    errorCode: string | null;
    itemsCount: number;
  },
): Promise<void> {
  const { error } = await supabase.rpc("complete_apify_actor_run", {
    p_request_key: input.requestKey,
    p_success: input.success,
    p_provider_request_id: input.providerRequestId,
    p_http_status: input.httpStatus,
    p_error_code: input.errorCode,
    p_items_count: input.itemsCount,
    p_metadata: { source: "contact_enrichment" },
  });
  if (error) throw new Error(`Finalisation quota Apify non confirmée: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// enrich-contacts-linkedin (v2) — dispatcher ASYNCHRONE.
//
// Trouve les ACHETEURS OPÉRATIONNELS (office manager, assistante de direction, achats,
// communication, RH, événementiel) chez l'entreprise du signal — les VRAIS interlocuteurs
// cadeaux Gourmet, pas les dirigeants légaux Pappers.
//
// Ici : on SOUMET juste la run Apify (scrape LinkedIn = plusieurs minutes) et on rend la main
// tout de suite. Le cron `cron-check-linkedin-enrich` récolte, filtre par persona, vérifie les
// emails via Dropcontact et écrit les contacts. Contrat DB identique aux autres voies.
//
// Routage : enrichment-worker quand settings.enrichment_provider = 'linkedin'.
// ─────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let enrichmentId: string | null = null;
  let activeSignalId: string | null = null;
  let activeQueueClaim: EnrichmentQueueClaim | null = null;
  try {
    const body = await req.json();
    const signal_id = body?.signal_id;
    const queueClaim = typeof body?.enrichment_job_id === "string" &&
        typeof body?.enrichment_lease_token === "string"
      ? {
        job_id: body.enrichment_job_id,
        lease_token: body.enrichment_lease_token,
      }
      : null;
    if (!signal_id) {
      return new Response(JSON.stringify({ error: "signal_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!queueClaim) {
      return new Response(JSON.stringify({ error: "enrichment queue claim is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    activeQueueClaim = queueClaim;
    activeSignalId = signal_id;

    const { data: signal, error: sigErr } = await supabase
      .from("signals").select("*").eq("id", signal_id).single();
    if (sigErr || !signal) {
      return new Response(JSON.stringify({ error: "Signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gate Pappers (même sémantique que les autres voies : seul 'false' bloque).
    if ((signal.source_name || "") === "Pappers") {
      const { data: gate, error: gateError } = await supabase
        .from("settings").select("value").eq("key", "pappers_enrichment_enabled").maybeSingle();
      if (gateError) throw new Error(`read Pappers gate: ${gateError.message}`);
      if (gate?.value === "false") {
        return new Response(JSON.stringify({ skipped: true, reason: "pappers_enrichment_suspended" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Idempotence : un état fournisseur non terminal doit être repris à partir
    // de sa preuve durable, sans fenêtre d'âge locale.
    const { data: existing, error: existingError } = await supabase
      .from("company_enrichment").select("*").eq("signal_id", signal_id).maybeSingle();
    if (existingError) throw new Error(`read company_enrichment: ${existingError.message}`);
    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, status: "completed", message: "already enriched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY");

    // La création/réouverture et le passage du signal à processing sont une
    // seule transaction conditionnée au lease du worker courant.
    const begun = await beginEnrichmentDispatch(
      supabase,
      queueClaim,
      signal_id,
      signal.company_name,
    );
    enrichmentId = begun.enrichmentId;
    if (begun.alreadyCompleted) {
      return new Response(JSON.stringify({
        success: true,
        status: "completed",
        message: "already enriched",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const personaSettingKey = signal.source_name === "Pappers"
      ? "personas_pappers"
      : signal.source_name === "LinkedIn"
      ? "personas_linkedin"
      : "personas_presse";
    const { data: personaSetting, error: personaSettingError } = await supabase
      .from("settings").select("value").eq("key", personaSettingKey).maybeSingle();
    if (personaSettingError) throw new Error(`read ${personaSettingKey}: ${personaSettingError.message}`);
    const personas = parsePersonasSetting(personaSetting?.value);

    // Le site officiel est déjà connu quand Pappers l'a fourni, et il porte la
    // marque là où le nom légal ne porte qu'un libellé administratif. Lecture
    // locale, aucun appel fournisseur : c'est ce qui permet de chercher
    // « akkodis » plutôt que « AKKODIS HIGH TECH SAS ».
    const { data: enrichmentSite, error: enrichmentSiteError } = await supabase
      .from("company_enrichment").select("website, domain")
      .eq("signal_id", signal_id).maybeSingle();
    if (enrichmentSiteError) {
      throw new Error(`read company website: ${enrichmentSiteError.message}`);
    }
    // Mode de scraping : réglable en base pour qu'un essai soit annulable sans
    // redéploiement. Absent ou inconnu -> mode économique.
    const { data: scraperModeSetting } = await supabase
      .from("settings").select("value").eq("key", "apify_profile_scraper_mode").maybeSingle();
    const scraperMode = resolveScraperMode(
      typeof scraperModeSetting?.value === "string" ? scraperModeSetting.value : null,
    );

    const companySearch = chooseCompanySearchQuery(
      signal.company_name,
      enrichmentSite?.website || enrichmentSite?.domain || null,
    );

    // Deux runs Actor sont nécessaires : résolution société puis employés.
    // Chacune porte une clé métier stable, une réservation de run et un état
    // dispatched durable avant POST. `usageTotalUsd` reste mesuré séparément
    // par le poller terminal et ne pilote jamais ce plafond.
    const businessOperationKey = enrichmentBusinessOperationKey(
      begun.operationGeneration,
      "linkedin-contacts-v1",
    );
    const priorRawData = begun.rawData;
    let workingRawData: Record<string, unknown> = priorRawData;
    const companyRequestKey = apifyActorOperationKey(
      begun.operationGeneration,
      "linkedin_company_search",
    );
    const employeeRequestKey = apifyActorOperationKey(
      begun.operationGeneration,
      "linkedin_employee_submit",
    );
    const [priorSubmissionResult, priorCompanyResult, quotaResult] = await Promise.all([
      supabase
        .from("provider_usage_events")
        .select("metadata,occurred_at,success,error_code")
        .eq("provider", "apify")
        .eq("operation", "linkedin_employee_submit")
        .eq("request_key", employeeRequestKey)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("provider_usage_events")
        .select("metadata,occurred_at,success,error_code")
        .eq("provider", "apify")
        .eq("operation", "linkedin_company_search")
        .eq("request_key", companyRequestKey)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("provider_quota_reservations")
        .select("id,request_key,status,metadata")
        .eq("provider", "apify")
        .in("request_key", [companyRequestKey, employeeRequestKey]),
    ]);
    if (priorSubmissionResult.error || priorCompanyResult.error || quotaResult.error) {
      throw new Error(
        `Preuve Apify illisible: ${
          priorSubmissionResult.error?.message || priorCompanyResult.error?.message || quotaResult.error?.message
        }`,
      );
    }
    const priorSubmissions = priorSubmissionResult.data || [];
    const priorCompanyCalls = priorCompanyResult.data || [];
    const quotaRows = quotaResult.data || [];
    const companyQuotaRows = quotaRows.filter((row: any) => row.request_key === companyRequestKey);
    const employeeQuotaRows = quotaRows.filter((row: any) => row.request_key === employeeRequestKey);

    let latestCompanyUsage: ApifyCallUsage | null = null;
    let latestEmployeeUsage: ApifyCallUsage | null = null;
    const recordApifyUsage = async (usage: ApifyCallUsage) => {
      if (usage.operation === "linkedin_company_search") latestCompanyUsage = usage;
      if (usage.operation === "linkedin_employee_submit") latestEmployeeUsage = usage;
    };

    const employeeResultCache = recordValue(priorRawData.apify_employee_submit_result);
    const employeeRecovery = decideApifyActorRunRecovery({
      requestKey: employeeRequestKey,
      localRequestKey: priorRawData.apify_employee_request_key,
      localReservationId: priorRawData.apify_employee_reservation_id,
      localStage: priorRawData.apify_employee_stage,
      localProviderTaskId: priorRawData.apify_run_id || employeeResultCache?.provider_request_id,
      hasCachedResult: Boolean(employeeResultCache),
      reservationRows: employeeQuotaRows,
      providerLedgerRows: priorSubmissions,
      allowLegacyProviderProof: true,
    });
    if (employeeRecovery.kind === "blocked") {
      throw new Error(`Reprise Apify employés bloquée (${employeeRecovery.reason})`);
    }
    if (employeeRecovery.kind === "finalize_and_reuse") {
      const cachedEmployeeSuccess = employeeResultCache?.success === true;
      await completeApifyActorRun(supabase, {
        requestKey: employeeRequestKey,
        success: employeeRecovery.providerTaskId ? true : cachedEmployeeSuccess,
        providerRequestId: employeeRecovery.providerTaskId,
        httpStatus: typeof employeeResultCache?.http_status === "number"
          ? employeeResultCache.http_status
          : null,
        errorCode: typeof employeeResultCache?.error_code === "string"
          ? employeeResultCache.error_code
          : null,
        itemsCount: typeof employeeResultCache?.items_count === "number"
          ? employeeResultCache.items_count
          : 0,
      });
    }
    if (
      ["reuse", "reuse_legacy", "finalize_and_reuse"].includes(employeeRecovery.kind) &&
      employeeRecovery.providerTaskId
    ) {
      const terminalOutcome = typeof priorRawData.outcome === "string"
        ? priorRawData.outcome
        : null;
      if (existing?.status === "failed" && terminalOutcome) {
        throw new Error(`Run Apify antérieure déjà terminale (${terminalOutcome})`);
      }
      const recoveredStatus = existing?.status === "dropcontact_processing"
        ? "dropcontact_processing"
        : "linkedin_processing";
      const latestSubmission = Array.isArray(priorSubmissions) ? priorSubmissions[0] : null;
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        {
          status: recoveredStatus,
          enrichment_source: "linkedin",
          resolution_technical_status: existing?.resolution_technical_status ?? null,
          operational_profiles_count: Number(existing?.operational_profiles_count || 0),
          raw_data: {
            ...priorRawData,
            source: "linkedin",
            apify_run_id: employeeRecovery.providerTaskId,
            apify_dataset_id: priorRawData.apify_dataset_id || null,
            company_query: signal.company_name,
            personas_requested: priorRawData.personas_requested || personas,
            personas_setting_key: priorRawData.personas_setting_key || personaSettingKey,
            personas_signal_source: priorRawData.personas_signal_source || signal.source_name || null,
            business_operation_key: businessOperationKey,
            queue_claim: queueClaim,
            apify_employee_request_key: employeeRequestKey,
            apify_employee_stage: "provider_accepted",
            recovered_provider_task_from: employeeRecovery.reason,
            started_at: typeof priorRawData.started_at === "string"
              ? priorRawData.started_at
              : latestSubmission?.occurred_at || new Date().toISOString(),
          },
        },
        "processing",
        "processing",
      );
      return new Response(JSON.stringify({
        success: true,
        already_running: true,
        status: recoveredStatus,
        provider: "linkedin",
        signal_id,
        enrichment_id: enrichmentId,
        apify_run_id: employeeRecovery.providerTaskId,
        dropcontact_request_id: typeof priorRawData.dropcontact_request_id === "string"
          ? priorRawData.dropcontact_request_id
          : undefined,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (
      ["reuse", "reuse_legacy", "finalize_and_reuse"].includes(employeeRecovery.kind) &&
      employeeResultCache && !employeeRecovery.providerTaskId
    ) {
      throw new Error("Tentative Apify employés déjà terminale sans run récupérable");
    }

    const companyResultCache = recordValue(priorRawData.apify_company_search_result);
    let companyResolution = durableCompanyResolution(companyResultCache?.resolution) ||
      durableCompanyResolution(priorRawData.company_resolution);
    if (priorCompanyCalls.length > 0 && !companyResolution) {
      throw new Error("Recherche société Apify legacy sans réponse durable: réconciliation requise");
    }
    const companyRecovery = decideApifyActorRunRecovery({
      requestKey: companyRequestKey,
      localRequestKey: priorRawData.apify_company_request_key,
      localReservationId: priorRawData.apify_company_reservation_id,
      localStage: priorRawData.apify_company_stage,
      localProviderTaskId: null,
      hasCachedResult: Boolean(companyResolution),
      reservationRows: companyQuotaRows,
      providerLedgerRows: [],
      allowLegacyProviderProof: true,
    });
    if (companyRecovery.kind === "blocked") {
      throw new Error(`Reprise recherche société Apify bloquée (${companyRecovery.reason})`);
    }

    let companyReservationId = companyRecovery.reservationId;
    if (companyRecovery.kind === "reserve") {
      if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY manquante");
      workingRawData = {
        ...workingRawData,
        source: "linkedin",
        apify_company_request_key: companyRequestKey,
        apify_company_stage: "intent",
        company_query: signal.company_name,
        // Ce qui est RÉELLEMENT envoyé au fournisseur, à côté du nom légal :
        // sans ça, un échec de résolution reste inexplicable des mois plus tard.
        company_search_query: companySearch.query,
        // Le mode de scraping facturé, écrit noir sur blanc : un essai à
        // 8 $/1000 doit rester distinguable d'une exploitation à 4 $/1000.
        apify_profile_scraper_mode: scraperMode,
        // D'où vient cette requête : le nom légal, ou la marque déduite du site.
        // Un contact obtenu via la marque doit rester identifiable comme tel —
        // le domaine peut désigner la maison mère plutôt que l'établissement.
        company_search_query_source: companySearch.source,
        personas_requested: personas,
        personas_setting_key: personaSettingKey,
        personas_signal_source: signal.source_name || null,
        business_operation_key: businessOperationKey,
        queue_claim: queueClaim,
      };
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
        "processing",
        "processing",
      );
      companyReservationId = await reserveApifyActorRun(supabase, {
        requestKey: companyRequestKey,
        operation: "linkedin_company_search",
        enrichmentId: enrichmentId!,
        signalId: signal_id,
      });
    }

    if (companyRecovery.kind === "reserve" || companyRecovery.kind === "dispatch") {
      if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY manquante");
      await markApifyActorRunDispatched(supabase, companyRequestKey);
      workingRawData = {
        ...workingRawData,
        source: "linkedin",
        apify_company_request_key: companyRequestKey,
        apify_company_reservation_id: companyReservationId,
        apify_company_stage: "dispatched",
        queue_claim: queueClaim,
      };
      // Le checkpoint local suit la mutation SQL mais précède le POST. Si ce
      // write échoue, la réservation dispatched bloque toute resoumission.
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
        "processing",
        "processing",
      );
      // Ce qu'on envoie au fournisseur est décidé par `chooseCompanySearchQuery`
      // (nom légal normalisé, ou marque déduite du site quand le nom légal
      // n'est qu'un libellé administratif). La requête retenue ET sa source
      // sont consignées dans `raw_data` : un échec de résolution doit rester
      // explicable, et un contact obtenu via la marque doit rester
      // identifiable comme tel.
      companyResolution = await resolveCompanyLinkedInUrl(
        APIFY_API_KEY,
        companySearch.query,
        recordApifyUsage,
      );
      const companyUsage = latestCompanyUsage as ApifyCallUsage | null;
      if (!companyUsage) {
        throw new Error("Réponse recherche société Apify sans preuve d'appel");
      }
      const companyCache = {
        success: companyUsage.success,
        http_status: companyUsage.httpStatus,
        error_code: companyUsage.errorCode,
        items_count: companyUsage.itemsCount,
        resolution: companyResolution,
      };
      workingRawData = {
        ...workingRawData,
        apify_company_stage: "response_cached",
        apify_company_search_result: companyCache,
        company_resolution: companyResolution,
      };
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
        "processing",
        "processing",
      );
      await completeApifyActorRun(supabase, {
        requestKey: companyRequestKey,
        success: companyUsage.success,
        providerRequestId: null,
        httpStatus: companyUsage.httpStatus,
        errorCode: companyUsage.errorCode,
        itemsCount: companyUsage.itemsCount,
      });
    } else if (companyRecovery.kind === "finalize_and_reuse") {
      if (!companyResultCache) {
        throw new Error("Cache recherche société Apify incomplet");
      }
      await completeApifyActorRun(supabase, {
        requestKey: companyRequestKey,
        success: companyResultCache.success === true,
        providerRequestId: null,
        httpStatus: typeof companyResultCache.http_status === "number"
          ? companyResultCache.http_status
          : null,
        errorCode: typeof companyResultCache.error_code === "string"
          ? companyResultCache.error_code
          : null,
        itemsCount: typeof companyResultCache.items_count === "number"
          ? companyResultCache.items_count
          : 0,
      });
    }

    if (!companyResolution) {
      throw new Error("Résolution société Apify durable absente");
    }
    if (companyResolution.status !== "resolved" || !companyResolution.linkedinUrl) {
      const resolutionReason = String(companyResolution.provenance?.reason || "unknown");
      const resolutionCompletedWithoutMatch =
        !/(provider_|usage_|network|timeout|invalid)/i.test(resolutionReason);
      const errorMessage = `Résolution société ${companyResolution.status}: ${resolutionReason}`;
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        {
          status: "failed",
          enrichment_source: "linkedin",
          error_message: `LinkedIn (Apify) : ${errorMessage}`.slice(0, 300),
          resolution_status: companyResolution.status,
          resolution_score: companyResolution.score,
          resolution_provenance: companyResolution.provenance,
          resolution_technical_status: resolutionCompletedWithoutMatch ? "completed" : "failed",
          operational_profiles_count: 0,
          linkedin_company_url: null,
          raw_data: {
            ...workingRawData,
            outcome: `company_${companyResolution.status}`,
            failed_at: new Date().toISOString(),
          },
        },
        "failed",
      );
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let employeeReservationId = employeeRecovery.reservationId;
    if (employeeRecovery.kind === "reserve") {
      if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY manquante");
      workingRawData = {
        ...workingRawData,
        apify_employee_request_key: employeeRequestKey,
        apify_employee_stage: "intent",
        company_resolution: companyResolution,
      };
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
        "processing",
        "processing",
      );
      employeeReservationId = await reserveApifyActorRun(supabase, {
        requestKey: employeeRequestKey,
        operation: "linkedin_employee_submit",
        enrichmentId: enrichmentId!,
        signalId: signal_id,
      });
    }

    if (employeeRecovery.kind !== "reserve" && employeeRecovery.kind !== "dispatch") {
      throw new Error(`État Apify employés non exécutable (${employeeRecovery.kind})`);
    }
    if (!APIFY_API_KEY) throw new Error("APIFY_API_KEY manquante");
    await markApifyActorRunDispatched(supabase, employeeRequestKey);
    workingRawData = {
      ...workingRawData,
      apify_employee_request_key: employeeRequestKey,
      apify_employee_reservation_id: employeeReservationId,
      apify_employee_stage: "dispatched",
    };
    await updateEnrichmentDispatch(
      supabase,
      queueClaim,
      enrichmentId!,
      { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
      "processing",
      "processing",
    );

    console.log(`[enrich-linkedin] ${signal_id} apify employees submit start "${signal.company_name}"`);
    const submitted = await submitCompanyEmployeesRun(
      APIFY_API_KEY,
      signal.company_name,
      personas,
      recordApifyUsage,
      companyResolution,
      scraperMode,
    );
    console.log(`[enrich-linkedin] ${signal_id} apify employees submit done: ${JSON.stringify(submitted).slice(0, 200)}`);
    const employeeUsage = latestEmployeeUsage as ApifyCallUsage | null;
    if (!employeeUsage) {
      throw new Error("Réponse soumission employés Apify sans preuve d'appel");
    }
    const employeeCache = {
      success: employeeUsage.success,
      http_status: employeeUsage.httpStatus,
      error_code: employeeUsage.errorCode,
      items_count: employeeUsage.itemsCount,
      provider_request_id: "runId" in submitted ? submitted.runId : null,
      dataset_id: "runId" in submitted ? submitted.datasetId : null,
      error: "error" in submitted ? submitted.error : null,
    };
    workingRawData = {
      ...workingRawData,
      apify_employee_stage: "response_cached",
      apify_employee_submit_result: employeeCache,
      apify_run_id: employeeCache.provider_request_id,
      apify_dataset_id: employeeCache.dataset_id,
    };
    await updateEnrichmentDispatch(
      supabase,
      queueClaim,
      enrichmentId!,
      { status: "processing", enrichment_source: "linkedin", raw_data: workingRawData },
      "processing",
      "processing",
    );
    await completeApifyActorRun(supabase, {
      requestKey: employeeRequestKey,
      success: employeeUsage.success,
      providerRequestId: employeeUsage.providerRequestId,
      httpStatus: employeeUsage.httpStatus,
      errorCode: employeeUsage.errorCode,
      itemsCount: employeeUsage.itemsCount,
    });

    if ("error" in submitted) {
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        {
          status: "failed",
          enrichment_source: "linkedin",
          error_message: `LinkedIn (Apify) : ${submitted.error}`.slice(0, 300),
          resolution_status: companyResolution.status,
          resolution_score: companyResolution.score,
          resolution_provenance: companyResolution.provenance,
          resolution_technical_status: "failed",
          operational_profiles_count: 0,
          linkedin_company_url: companyResolution.linkedinUrl,
          raw_data: {
            ...workingRawData,
            outcome: "apify_submit_error",
            failed_at: new Date().toISOString(),
          },
        },
        "failed",
      );
      return new Response(JSON.stringify({ error: submitted.error }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await updateEnrichmentDispatch(
      supabase,
      queueClaim,
      enrichmentId!,
      {
        status: "linkedin_processing",
        enrichment_source: "linkedin",
        error_message: null,
        linkedin_company_url: companyResolution.linkedinUrl,
        resolution_status: companyResolution.status,
        resolution_score: companyResolution.score,
        resolution_provenance: companyResolution.provenance,
        resolution_technical_status: null,
        operational_profiles_count: 0,
        raw_data: {
          ...workingRawData,
          apify_employee_stage: "provider_accepted",
          company_query: signal.company_name,
          personas_requested: submitted.personas,
          personas_setting_key: personaSettingKey,
          personas_signal_source: signal.source_name || null,
          business_operation_key: businessOperationKey,
          queue_claim: queueClaim,
          started_at: new Date().toISOString(),
        },
      },
      "processing",
    );

    return new Response(JSON.stringify({
      success: true,
      provider: "linkedin",
      signal_id,
      enrichment_id: enrichmentId,
      apify_run_id: submitted.runId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[enrich-contacts-linkedin] Error:", msg);
    if (enrichmentId && activeSignalId && activeQueueClaim && !msg.startsWith("dispatch_fence_lost:")) {
      try {
        await updateEnrichmentDispatch(
          supabase,
          activeQueueClaim,
          enrichmentId,
          {
            status: "failed",
            enrichment_source: "linkedin",
            error_message: `LinkedIn: ${msg}`.slice(0, 300),
            resolution_technical_status: "failed",
            operational_profiles_count: 0,
          },
          "failed",
          "processing",
        );
      } catch (persistError) {
        console.error(
          "[enrich-contacts-linkedin] Fenced failure persistence rejected:",
          persistError instanceof Error ? persistError.message : persistError,
        );
      }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

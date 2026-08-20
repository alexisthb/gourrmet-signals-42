import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  dropcontactBalanceMetadata,
  dropcontactEmailQualifications,
  dropcontactSubmissionKeys,
  submitDropcontactBatch,
  pollDropcontactBatch,
  findDropcontactResult,
  pickVerifiedEmail,
  type DropcontactCallUsage,
  type DropcontactInput,
} from "../_shared/dropcontact.ts";
import {
  matchPersonaForTitle,
  parsePersonasSetting,
  type Persona,
  type ResolutionStatus,
} from "../_shared/apify-linkedin.ts";
import {
  decidePappersCompanyRecovery,
  decideWaterfallProviderRecovery,
  parseEnrichmentDispatchIdentity,
  pappersCompanyOperationKey,
  type PappersCompanyResponseCache,
} from "../_shared/enrichment-provider-budget.ts";
import { persistProviderUsage } from "../_shared/provider-usage.ts";
import {
  extractPappersRepresentatives,
  type PappersContactCandidate,
} from "../_shared/pappers-contact-resolution.ts";

// ─────────────────────────────────────────────────────────────────────────────
// enrich-contacts — enrichissement contacts SANS Manus (cascade "waterfall").
//
//   SIREN → fiche Pappers (représentants RÉELS) → Dropcontact (email pro vérifié) → contacts
//
// v1 : couvre le canal Pappers (le gros du volume/coût). Les personnes viennent du registre
// légal (jamais inventées) ; Dropcontact n'ajoute qu'un email vérifié (jamais un nom).
// Synchrone : la fonction écrit les contacts et termine l'enrichissement dans le même appel
// (polling Dropcontact borné pour rester sous le timeout worker de 60 s). Aucun cron requis.
//
// Routage : appelée par enrichment-worker quand settings.enrichment_provider='waterfall'.
// Contrat DB IDENTIQUE à la voie Manus (mêmes colonnes contacts/company_enrichment) pour que
// l'UI, les hooks et le reste ne voient aucune différence.
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichmentRequest {
  signal_id: string;
  enrichment_job_id?: string;
  enrichment_lease_token?: string;
}

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
    p_enrichment_source: "waterfall",
  });
  if (error) throw new Error(`begin waterfall dispatch: ${error.message}`);
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
): Promise<void> {
  const { data, error } = await supabase.rpc("update_enrichment_dispatch", {
    p_job_id: claim.job_id,
    p_lease_token: claim.lease_token,
    p_enrichment_id: enrichmentId,
    p_company_patch: companyPatch,
    p_signal_status: signalStatus,
    p_expected_status: null,
  });
  if (error) throw new Error(`update waterfall dispatch: ${error.message}`);
  if (data !== true) throw new Error(`dispatch_fence_lost:${claim.job_id}`);
}

async function completeEnrichmentDispatch(
  supabase: any,
  claim: EnrichmentQueueClaim,
  enrichmentId: string,
  companyPatch: Record<string, unknown>,
  contacts: Array<Record<string, unknown>>,
): Promise<number> {
  const { data, error } = await supabase.rpc("complete_enrichment_dispatch", {
    p_job_id: claim.job_id,
    p_lease_token: claim.lease_token,
    p_enrichment_id: enrichmentId,
    p_company_patch: companyPatch,
    p_contacts: contacts,
  });
  if (error) throw new Error(`complete waterfall dispatch: ${error.message}`);
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (result.accepted !== true) throw new Error(`dispatch_fence_lost:${claim.job_id}`);
  return typeof result.contacts_inserted === "number" ? result.contacts_inserted : 0;
}

type Candidate = PappersContactCandidate;

// Normalise "N/A"/"-"/vide -> null (mêmes littéraux que la voie Manus).
function norm(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(n\/?a|na|-|null|none|undefined)$/i.test(t)) return null;
  return t;
}

// Scoring persona IDENTIQUE à cron-check-manus (office manager/assistante=5, direction=4…),
// + bonus de fraîcheur du signal. is_priority_target = score >= 4.
function personaBaseScore(jobTitle: string | null, personas: Persona[]): number {
  const persona = matchPersonaForTitle(jobTitle, personas);
  if (persona?.isPriority) return 5;
  if (persona) return 4;
  return 3;
}
function freshnessBonus(detectedAt: string | null): number {
  if (!detectedAt) return 0;
  const days = (Date.now() - new Date(detectedAt).getTime()) / 86_400_000;
  if (days <= 7) return 2;
  if (days <= 30) return 1;
  return 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let enrichmentId: string | null = null;
  let activeSignalId: string | null = null;
  let activeQueueClaim: EnrichmentQueueClaim | null = null;
  let resolvedOperationalProfiles = 0;
  try {
    const body: EnrichmentRequest = await req.json();
    const signal_id = body.signal_id;
    const queueClaim = typeof body.enrichment_job_id === "string" &&
        typeof body.enrichment_lease_token === "string"
      ? {
        job_id: body.enrichment_job_id,
        lease_token: body.enrichment_lease_token,
      }
      : null;
    if (!signal_id) {
      return new Response(JSON.stringify({ error: "signal_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // 1. Signal
    const { data: signal, error: signalError } = await supabase
      .from("signals").select("*").eq("id", signal_id).single();
    if (signalError || !signal) {
      return new Response(JSON.stringify({ error: "Signal not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Gate Pappers (même sémantique que la voie Manus : seul 'false' bloque).
    if ((signal.source_name || "") === "Pappers") {
      const { data: gate, error: gateError } = await supabase
        .from("settings").select("value").eq("key", "pappers_enrichment_enabled").maybeSingle();
      if (gateError) throw new Error(`read Pappers gate: ${gateError.message}`);
      if (gate?.value === "false") {
        return new Response(JSON.stringify({ skipped: true, reason: "pappers_enrichment_suspended", signal_id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 3. Déjà enrichi / en vol (idempotence, anti-doublon).
    const { data: existing, error: existingError } = await supabase
      .from("company_enrichment").select("*").eq("signal_id", signal_id).maybeSingle();
    if (existingError) throw new Error(`read company_enrichment: ${existingError.message}`);
    if (existing && existing.status === "completed") {
      return new Response(JSON.stringify({ success: true, message: "Signal already enriched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // `processing` n'est pas une tâche fournisseur durable pour cette voie
    // synchrone. Un worker mort doit donc pouvoir reprendre le waterfall au
    // claim suivant; la lease + l'unicité de queue portent l'anti-concurrence.

    // 4. La tentative devient visible dans la même transaction que la
    // validation du lease; un ancien dispatcher ne peut pas rouvrir le run.
    const begun = await beginEnrichmentDispatch(
      supabase,
      queueClaim,
      signal_id,
      signal.company_name,
    );
    enrichmentId = begun.enrichmentId;
    if (begun.alreadyCompleted) {
      return new Response(JSON.stringify({ success: true, message: "Signal already enriched" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Clé Dropcontact (env puis settings, comme les autres providers).
    let DROPCONTACT_API_KEY = Deno.env.get("DROPCONTACT_API_KEY") || null;
    if (!DROPCONTACT_API_KEY) {
      const { data: s, error: dropcontactSettingError } = await supabase
        .from("settings").select("value").eq("key", "dropcontact_api_key").maybeSingle();
      if (dropcontactSettingError) throw new Error(`read Dropcontact setting: ${dropcontactSettingError.message}`);
      DROPCONTACT_API_KEY = s?.value || null;
    }
    const { data: personaSetting, error: personaSettingError } = await supabase
      .from("settings").select("value").eq("key", "personas_pappers").maybeSingle();
    if (personaSettingError) throw new Error(`read Pappers personas: ${personaSettingError.message}`);
    const personas = parsePersonasSetting(personaSetting?.value);

    // 6. Récupère le SIREN (posé sur pappers_signals lors du transfert) puis la fiche Pappers.
    const { data: pappersRow, error: pappersRowError } = await supabase
      .from("pappers_signals").select("siren, company_data").eq("signal_id", signal_id).limit(1).maybeSingle();
    if (pappersRowError) throw new Error(`read Pappers signal: ${pappersRowError.message}`);
    const siren = norm(pappersRow?.siren) || norm(signal?.siren);

    // La preuve Dropcontact et les candidats durables sont lus AVANT tout
    // nouvel appel Pappers. Une reprise reste donc dans l'étape fournisseur
    // déjà payée au lieu de reconstruire la cascade depuis le début.
    const { requestKey: submitRequestKey } = dropcontactSubmissionKeys(
      begun.operationGeneration,
    );
    const existingRawData = begun.rawData;
    let workingRawData: Record<string, unknown> = existingRawData;
    const { data: priorSubmit, error: submitPreflightError } = await supabase
      .from("provider_usage_events")
      .select("metadata, occurred_at")
      .eq("provider", "dropcontact")
      .eq("request_key", submitRequestKey)
      .maybeSingle();
    if (submitPreflightError) {
      throw new Error(`Ledger Dropcontact illisible: ${submitPreflightError.message}`);
    }
    const waterfallRecovery = decideWaterfallProviderRecovery(
      existingRawData,
      priorSubmit ? [priorSubmit] : [],
    );
    if (waterfallRecovery.kind === "blocked") {
      throw new Error(`Reprise waterfall bloquée (${waterfallRecovery.reason})`);
    }

    const persistedCompanyResolution = existingRawData.company_resolution &&
        typeof existingRawData.company_resolution === "object"
      ? existingRawData.company_resolution as Record<string, unknown>
      : {};
    const persistedResolutionCounts = existingRawData.contact_resolution_counts &&
        typeof existingRawData.contact_resolution_counts === "object"
      ? existingRawData.contact_resolution_counts as Record<string, unknown>
      : {};
    let candidates: Candidate[] = waterfallRecovery.kind === "start_pappers"
      ? []
      : existingRawData.candidates as Candidate[];
    let website: string | null = norm(existingRawData.website) || norm(existing?.website);
    let industry: string | null = norm(existingRawData.industry) || norm(existing?.industry) ||
      (typeof signal.sector === "string" ? signal.sector : null);
    let contactResolutionCounts: Record<ResolutionStatus, number> = {
      resolved: Number(persistedResolutionCounts.resolved || 0),
      ambiguous: Number(persistedResolutionCounts.ambiguous || 0),
      rejected: Number(persistedResolutionCounts.rejected || 0),
    };
    let contactResolutionReasonCounts: Record<string, number> =
      existingRawData.contact_resolution_reason_counts &&
        typeof existingRawData.contact_resolution_reason_counts === "object"
        ? existingRawData.contact_resolution_reason_counts as Record<string, number>
        : {};
    let contactResolutionMeasuredAt: string | null = typeof existingRawData.contact_resolution_measured_at === "string"
      ? existingRawData.contact_resolution_measured_at
      : existing?.contact_resolution_measured_at || null;
    let companyResolutionStatus: ResolutionStatus = ["resolved", "ambiguous", "rejected"].includes(
        String(persistedCompanyResolution.status || ""),
      )
      ? persistedCompanyResolution.status as ResolutionStatus
      : "rejected";
    let companyResolutionScore = Number(persistedCompanyResolution.score || existing?.resolution_score || 0);
    let companyResolutionProvenance: Record<string, unknown> =
      persistedCompanyResolution.provenance && typeof persistedCompanyResolution.provenance === "object"
        ? persistedCompanyResolution.provenance as Record<string, unknown>
        : {
      provider: "pappers",
      algorithm: "siren-evidence-v1",
      query_siren: siren || null,
      reason: siren ? "provider_not_configured" : "siren_missing",
    };

    const PAPPERS_API_KEY = Deno.env.get("PAPPERS_API_KEY") || null;
    if (waterfallRecovery.kind === "start_pappers" && siren) {
      const requestKey = pappersCompanyOperationKey(begun.operationGeneration);
      // Le quota autoritaire est réservé sous verrou côté PostgreSQL et compte
      // les crédits consommés comme réservés. Cette lecture ne sert qu'à la
      // reprise de la même opération métier.
      const reservationSelect =
        "id,request_key,reservation_status,success,http_status,error_code,details";
      const byStableKey = await supabase
        .from("pappers_credit_usage")
        .select(reservationSelect)
        .eq("request_key", requestKey)
        .limit(2);
      const byLegacyRun = begun.operationGeneration === enrichmentId
        ? await supabase
          .from("pappers_credit_usage")
          .select(reservationSelect)
          .contains("details", { run_id: enrichmentId, operation: "entreprise" })
          .limit(2)
        : { data: [], error: null };
      if (byStableKey.error || byLegacyRun.error) {
        throw new Error(
          `Réservation Pappers illisible: ${
            byStableKey.error?.message || byLegacyRun.error?.message
          }`,
        );
      }
      const reservationRows = Array.from(new Map(
        [...(byStableKey.data || []), ...(byLegacyRun.data || [])]
          .map((row: Record<string, unknown>) => [row.id, row]),
      ).values());
      const pappersRecovery = decidePappersCompanyRecovery({
        requestKey,
        rawData: workingRawData,
        reservationRows: reservationRows || [],
      });
      if (pappersRecovery.kind === "blocked") {
        throw new Error(`Reprise Pappers bloquée (${pappersRecovery.reason})`);
      }

      let responseCache: PappersCompanyResponseCache | null =
        pappersRecovery.kind === "reuse_cached_response"
          ? pappersRecovery.cachedResponse
          : null;
      let usageId = pappersRecovery.kind === "reuse_cached_response"
        ? pappersRecovery.usageId
        : null;
      let reservationStatus = pappersRecovery.kind === "reuse_cached_response"
        ? pappersRecovery.reservationStatus
        : null;

      if (pappersRecovery.kind === "reserve_and_call" && !PAPPERS_API_KEY) {
        companyResolutionProvenance = {
          provider: "pappers",
          algorithm: "siren-evidence-v1",
          query_siren: siren.replace(/\D/g, ""),
          request_key: requestKey,
          reason: "provider_not_configured",
        };
      } else if (pappersRecovery.kind === "reserve_and_call") {
        workingRawData = {
          ...workingRawData,
          source: "waterfall",
          outcome: "pappers_intent",
          waterfall_stage: "pappers_intent",
          siren,
          pappers_request_key: requestKey,
          queue_claim: queueClaim,
        };
        // L'intention et sa clé logique sont durables avant la réservation.
        await updateEnrichmentDispatch(
          supabase,
          queueClaim,
          enrichmentId!,
          {
            status: "processing",
            enrichment_source: "waterfall",
            raw_data: workingRawData,
          },
          "processing",
        );
        const { data: reservation, error: reservationError } = await supabase.rpc(
          "reserve_pappers_company_credit",
          { p_request_key: requestKey, p_signal_id: signal_id, p_run_id: enrichmentId },
        );
        usageId = typeof reservation?.usage_id === "string" ? reservation.usage_id : null;
        if (reservationError || !usageId) {
          companyResolutionProvenance = {
            provider: "pappers",
            algorithm: "siren-evidence-v1",
            query_siren: siren.replace(/\D/g, ""),
            request_key: requestKey,
            reason: "budget_reservation_rejected",
            reservation_error: String(reservationError?.message || "missing_usage_id").slice(0, 160),
          };
        } else {
          reservationStatus = "reserved";
          workingRawData = {
            ...workingRawData,
            outcome: "pappers_calling",
            waterfall_stage: "pappers_calling",
            pappers_usage_id: usageId,
          };
          // Dès que le crédit est réservé, l'absence de réponse durable devient
          // ambiguë et interdit tout nouvel appel lors d'un reclaim.
          await updateEnrichmentDispatch(
            supabase,
            queueClaim,
            enrichmentId!,
            {
              status: "processing",
              enrichment_source: "waterfall",
              raw_data: workingRawData,
            },
            "processing",
          );
          let fiche: any = null;
          let httpStatus: number | null = null;
          let callSuccess = false;
          let callErrorCode: string | null = null;
          const pappersController = new AbortController();
          const pappersTimer = setTimeout(() => pappersController.abort(), 15_000);
          try {
            const url = `https://api.pappers.fr/v2/entreprise?api_token=${PAPPERS_API_KEY}&siren=${encodeURIComponent(siren)}`;
            const resp = await fetch(url, { signal: pappersController.signal });
            httpStatus = resp.status;
            if (resp.ok) {
              try {
                fiche = await resp.json();
                callSuccess = true;
              } catch {
                callErrorCode = "invalid_json";
              }
            } else {
              callErrorCode = `http_${resp.status}`;
            }
          } catch (error) {
            callErrorCode = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
          } finally {
            clearTimeout(pappersTimer);
          }
          responseCache = {
            request_key: requestKey,
            usage_id: usageId,
            success: callSuccess,
            http_status: httpStatus,
            error_code: callErrorCode,
            payload: fiche,
          };
          workingRawData = {
            ...workingRawData,
            outcome: "pappers_response_cached",
            waterfall_stage: "pappers_response_cached",
            pappers_response_cache: responseCache,
          };
          // Cache avant parsing et avant finalisation du coût : un crash
          // ultérieur reprend exactement cette réponse, jamais le GET.
          await updateEnrichmentDispatch(
            supabase,
            queueClaim,
            enrichmentId!,
            {
              status: "processing",
              enrichment_source: "waterfall",
              raw_data: workingRawData,
            },
            "processing",
          );
        }
      }

      if (responseCache && usageId) {
        if (reservationStatus === "reserved") {
          const { error: completionError } = await supabase.rpc("complete_pappers_company_credit", {
            p_usage_id: usageId,
            p_request_key: requestKey,
            p_signal_id: signal_id,
            p_run_id: enrichmentId,
            p_success: responseCache.success,
            p_http_status: responseCache.http_status,
            p_error_code: responseCache.error_code,
          });
          if (completionError) {
            // La RPC peut avoir abouti malgré une rupture réseau. Le prochain
            // reclaim relira son état avec le cache déjà durable.
            throw new Error(`Finalisation Pappers non confirmée: ${completionError.message}`);
          }
        }

        const fiche = responseCache.payload as any;
        if (responseCache.success && fiche) {
          const expectedSiren = siren.replace(/\D/g, "");
          const returnedSiren = norm(fiche?.siren)?.replace(/\D/g, "") || null;
          if (returnedSiren && returnedSiren !== expectedSiren) {
            companyResolutionProvenance = {
              provider: "pappers",
              algorithm: "siren-evidence-v1",
              query_siren: expectedSiren,
              returned_siren: returnedSiren,
              request_key: requestKey,
              reason: "siren_mismatch",
            };
          } else {
            companyResolutionStatus = "resolved";
            companyResolutionScore = 100;
            companyResolutionProvenance = {
              provider: "pappers",
              algorithm: "siren-evidence-v1",
              query_siren: expectedSiren,
              returned_siren: returnedSiren,
              request_key: requestKey,
              reason: returnedSiren ? "exact_siren" : "unique_siren_endpoint",
            };
            const ex = extractPappersRepresentatives(fiche);
            candidates = ex.candidates.map((candidate, index) => ({
              ...candidate,
              dropcontact_candidate_id: `${enrichmentId}:${index}`,
            }));
            contactResolutionCounts = ex.counts;
            contactResolutionReasonCounts = ex.reasonCounts;
            contactResolutionMeasuredAt = new Date().toISOString();
            website = ex.website;
            industry = ex.industry || industry;
          }
        } else {
          companyResolutionProvenance = {
            provider: "pappers",
            algorithm: "siren-evidence-v1",
            query_siren: siren.replace(/\D/g, ""),
            request_key: requestKey,
            reason: responseCache.error_code || "provider_error",
            http_status: responseCache.http_status,
          };
        }
      }
    }

    // Pas de représentant exploitable (ex. signal Presse sans SIREN, ou fiche vide) : on ne
    // fabrique rien. La découverte de contacts opérationnels arrive en v2 (Perplexity+Apify).
    if (candidates.length === 0) {
      const resolutionReason = String(companyResolutionProvenance.reason || "resolution_failed");
      const technicalFailure = Boolean(
        siren && (
          !PAPPERS_API_KEY ||
          /^(budget_|provider_error|http_|network_error|timeout|invalid_json|usage_finalize_error)/i
            .test(resolutionReason)
        )
      );
      const failureMessage = companyResolutionStatus === "resolved"
        ? "Aucun représentant personne physique résolu dans la fiche Pappers."
        : !siren
        ? "Signal sans SIREN — enrichissement waterfall limité au canal Pappers."
        : !PAPPERS_API_KEY
        ? "Clé API Pappers absente — aucun appel fournisseur effectué."
        : resolutionReason.startsWith("budget_")
        ? `Appel Pappers refusé par le budget configuré (${resolutionReason}).`
        : `Société non résolue par Pappers (${resolutionReason}).`;
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        {
          status: "failed",
          enrichment_source: "waterfall",
          error_message: failureMessage,
          resolution_status: companyResolutionStatus,
          resolution_score: companyResolutionScore,
          resolution_provenance: companyResolutionProvenance,
          resolution_technical_status: technicalFailure ? "failed" : "completed",
          operational_profiles_count: 0,
          contact_resolution_measured_at: contactResolutionMeasuredAt,
          contact_candidates_resolved: contactResolutionCounts.resolved,
          contact_candidates_ambiguous: contactResolutionCounts.ambiguous,
          contact_candidates_rejected: contactResolutionCounts.rejected,
          raw_data: {
            ...workingRawData,
            source: "waterfall",
            outcome: companyResolutionStatus === "resolved"
              ? "no_resolved_contacts"
              : `company_${companyResolutionStatus}`,
            siren: siren || null,
            company_resolution: {
              status: companyResolutionStatus,
              score: companyResolutionScore,
              provenance: companyResolutionProvenance,
            },
            contact_resolution_counts: contactResolutionCounts,
            contact_resolution_reason_counts: contactResolutionReasonCounts,
            queue_claim: queueClaim,
            failed_at: new Date().toISOString(),
          },
        },
        "failed",
      );
      return new Response(JSON.stringify({ success: false, reason: "no_candidates", signal_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    resolvedOperationalProfiles = candidates.length;

    const detectedAt: string | null = signal.detected_at || null;
    candidates = candidates.map((candidate) => {
      const persona = matchPersonaForTitle(candidate.job_title, personas);
      const priorityScore = Math.min(
        5,
        personaBaseScore(candidate.job_title, personas) + freshnessBonus(detectedAt),
      );
      return {
        ...candidate,
        persona_name: persona?.name || null,
        persona_priority: persona?.isPriority === true,
        priority_score: priorityScore,
        is_priority_target: priorityScore >= 4,
        location: null,
        linkedin_url: null,
      } as Candidate;
    });
    const durableWaterfallRawData: Record<string, unknown> = {
      ...workingRawData,
      source: "waterfall",
      outcome: waterfallRecovery.kind === "start_pappers"
        ? "dropcontact_ready"
        : existingRawData.outcome || "dropcontact_ready",
      waterfall_stage: waterfallRecovery.kind === "start_pappers"
        ? "dropcontact_ready"
        : existingRawData.waterfall_stage,
      siren: siren || null,
      website,
      industry,
      company_resolution: {
        status: companyResolutionStatus,
        score: companyResolutionScore,
        provenance: companyResolutionProvenance,
      },
      contact_resolution_counts: contactResolutionCounts,
      contact_resolution_reason_counts: contactResolutionReasonCounts,
      contact_resolution_measured_at: contactResolutionMeasuredAt,
      candidates,
      queue_claim: queueClaim,
    };
    if (waterfallRecovery.kind === "start_pappers") {
      // Le résultat Pappers est durable avant le premier octet envoyé à
      // Dropcontact : toute reprise suivante saute l'appel Pappers payant.
      await updateEnrichmentDispatch(
        supabase,
        queueClaim,
        enrichmentId!,
        {
          status: "processing",
          enrichment_source: "waterfall",
          website,
          industry,
          resolution_status: companyResolutionStatus,
          resolution_score: companyResolutionScore,
          resolution_provenance: companyResolutionProvenance,
          operational_profiles_count: candidates.length,
          contact_resolution_measured_at: contactResolutionMeasuredAt,
          contact_candidates_resolved: contactResolutionCounts.resolved,
          contact_candidates_ambiguous: contactResolutionCounts.ambiguous,
          contact_candidates_rejected: contactResolutionCounts.rejected,
          raw_data: durableWaterfallRawData,
        },
        "processing",
      );
    }

    // 7. Dropcontact : email pro vérifié pour chaque représentant réel (best-effort).
    // custom_fields relie chaque résultat à son candidat ; l'ordre du tableau n'est pas une preuve.
    const verifiedByIndex: Array<ReturnType<typeof pickVerifiedEmail>> = candidates.map(() => null);
    const phonesByIndex: Array<string | null> = candidates.map(() => null);
    const verificationStatusByIndex: Array<"verified" | "rejected" | "not_found" | "not_attempted"> =
      candidates.map(() => "not_attempted");
    const verificationQualificationsByIndex: string[][] = candidates.map(() => []);
    const verificationResultMatchedByIndex: boolean[] = candidates.map(() => false);
    let dropcontactNote = "not_configured";
    let dropcontactRequestId: string | null = null;
    let verificationCompleted = false;

    if (DROPCONTACT_API_KEY) {
      const inputs: DropcontactInput[] = candidates.map((c) => ({
        first_name: c.first_name || undefined,
        last_name: c.last_name || undefined,
        company: signal.company_name || undefined,
        website: website || undefined,
        num_siren: siren || undefined,
        job: c.job_title || undefined,
        custom_fields: { gourrmet_candidate_id: c.dropcontact_candidate_id as string },
      }));
      const pollCycleId = crypto.randomUUID();
      const recordDropcontactUsage = async (usage: DropcontactCallUsage) => {
        const requestKey = `dropcontact:enrich_poll:${usage.providerRequestId}:${pollCycleId}:${usage.attempt}`;
        await persistProviderUsage(supabase, {
          provider: "dropcontact",
          operation: usage.operation,
          requestKey,
          signalId: signal_id,
          runId: enrichmentId,
          success: usage.success,
          units: 0,
          itemsCount: usage.itemsCount,
          httpStatus: usage.httpStatus,
          errorCode: usage.errorCode,
          metadata: {
            ...dropcontactBalanceMetadata(usage),
            provider_request_id: usage.providerRequestId,
            attempt: usage.attempt,
            unit_basis: "not_returned_by_provider",
          },
        });
      };
      let dropcontactSubmittedAt = typeof existingRawData.dropcontact_submitted_at === "string"
        ? existingRawData.dropcontact_submitted_at
        : priorSubmit?.occurred_at || new Date().toISOString();
      if (waterfallRecovery.kind === "poll_dropcontact") {
        dropcontactRequestId = waterfallRecovery.taskId;
      } else {
        // Dès que l'intention de soumettre est durable, une absence de preuve
        // au retry est ambiguë et bloque toute seconde consommation.
        await updateEnrichmentDispatch(
          supabase,
          queueClaim,
          enrichmentId!,
          {
            status: "processing",
            enrichment_source: "waterfall",
            raw_data: {
              ...durableWaterfallRawData,
              outcome: "dropcontact_submitting",
              waterfall_stage: "dropcontact_submitting",
            },
          },
          "processing",
        );
        const submitted = await submitDropcontactBatch(DROPCONTACT_API_KEY, inputs, {
          supabase,
          enrichmentId: enrichmentId!,
          operationGeneration: begun.operationGeneration,
          signalId: signal_id,
          metadata: { source: "dropcontact_waterfall" },
        });
        if ("request_id" in submitted) {
          dropcontactRequestId = submitted.request_id;
          dropcontactSubmittedAt = new Date().toISOString();
        } else {
          throw new Error(`Soumission Dropcontact non récupérable: ${submitted.error}`);
        }
      }
      if (dropcontactRequestId) {
        const dropcontactProcessingRawData = {
          ...durableWaterfallRawData,
          outcome: "dropcontact_processing",
          waterfall_stage: "dropcontact_processing",
          dropcontact_request_id: dropcontactRequestId,
          dropcontact_submitted_at: dropcontactSubmittedAt,
        };
        // L'identifiant fournisseur et tous les candidats sont persistés avant
        // le premier poll : un crash ne peut plus forcer à rejouer Pappers.
        await updateEnrichmentDispatch(
          supabase,
          queueClaim,
          enrichmentId!,
          {
            status: "processing",
            enrichment_source: "waterfall",
            operational_profiles_count: candidates.length,
            raw_data: dropcontactProcessingRawData,
          },
          "processing",
        );
        const polled = await pollDropcontactBatch(
          DROPCONTACT_API_KEY,
          dropcontactRequestId,
          { maxAttempts: 7, delayMs: 6000 },
          recordDropcontactUsage,
        );
        if ("data" in polled) {
          dropcontactNote = "ok";
          verificationCompleted = true;
          candidates.forEach((candidate, i) => {
            const res = findDropcontactResult(
              polled.data,
              candidate.dropcontact_candidate_id as string,
              { first_name: candidate.first_name, last_name: candidate.last_name },
            );
            const verified = pickVerifiedEmail(res?.email);
            verifiedByIndex[i] = verified;
            verificationQualificationsByIndex[i] = dropcontactEmailQualifications(res?.email);
            verificationResultMatchedByIndex[i] = Boolean(res);
            phonesByIndex[i] = norm(res?.phone) || norm(res?.mobile_phone);
            verificationStatusByIndex[i] = verified
              ? "verified"
              : Array.isArray(res?.email) && res.email.length > 0
              ? "rejected"
              : "not_found";
          });
        } else {
          if (polled.ledger_error) throw new Error(polled.error);
          // Un délai local n'est pas un résultat fournisseur. Le job et
          // l'enrichissement restent en cours ; le cron reprend le même ID.
          await updateEnrichmentDispatch(
            supabase,
            queueClaim,
            enrichmentId!,
            {
              status: "dropcontact_processing",
              enrichment_source: "waterfall",
              operational_profiles_count: candidates.length,
              raw_data: {
                ...dropcontactProcessingRawData,
                outcome: polled.pending ? "dropcontact_pending" : "dropcontact_poll_retry",
              },
            },
            "processing",
          );
          return new Response(JSON.stringify({
            success: true,
            status: "dropcontact_processing",
            provider: "waterfall",
            signal_id,
            enrichment_id: enrichmentId,
            dropcontact_request_id: dropcontactRequestId,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    } else if (waterfallRecovery.kind === "poll_dropcontact") {
      throw new Error("Clé Dropcontact absente pour reprendre le lot accepté");
    }

    // 8. Construit les lignes contacts (contrat DB identique à la voie Manus).
    const contactRows = candidates.map((c, i) => {
      const full_name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
      const priority_score = Math.min(5, personaBaseScore(c.job_title, personas) + freshnessBonus(detectedAt));
      const persona = matchPersonaForTitle(c.job_title, personas);
      const verified = verifiedByIndex[i];
      const verificationStatus = verificationStatusByIndex[i];
      const verificationQualifications = verificationQualificationsByIndex[i];
      return {
        enrichment_id: enrichmentId,
        signal_id,
        full_name,
        first_name: c.first_name,
        last_name: c.last_name,
        job_title: c.job_title,
        department: null,
        location: null,
        email_principal: verified?.email || null,
        email_alternatif: null,
        phone: phonesByIndex[i],
        linkedin_url: null,
        is_priority_target: priority_score >= 4,
        priority_score,
        outreach_status: "new",
        resolution_status: c.resolution_status,
        resolution_score: c.resolution_score,
        resolution_provenance: c.resolution_provenance,
        email_verification_status: verificationStatus,
        email_verification_provider: verificationCompleted ? "dropcontact" : null,
        email_verification_qualification: verified?.qualification || verificationQualifications[0] || null,
        email_verification_confidence: verified?.confidence ?? null,
        email_verified_at: verified ? new Date().toISOString() : null,
        email_verification_provenance: {
          provider: verificationCompleted ? "dropcontact" : null,
          request_id: dropcontactRequestId,
          candidate_id: c.dropcontact_candidate_id,
          status: verificationStatus,
          qualifications: verificationQualifications,
          provider_result_matched: verificationResultMatchedByIndex[i],
          quantitative_confidence_supplied: false,
        },
        raw_data: {
          source: "waterfall",
          contact_source: c.source,
          persona_name: persona?.name || null,
          persona_priority: persona?.isPriority === true,
          email_status: verificationStatus,
          email_provider: verificationCompleted ? "dropcontact" : null,
          email_qualifications: verificationQualifications,
        },
      };
    }).filter((row) => row.full_name);
    resolvedOperationalProfiles = contactRows.length;

    // 9. Finalise l'enrichissement.
    const withEmail = contactRows.filter((r) => r.email_principal).length;
    const insertedCount = await completeEnrichmentDispatch(
      supabase,
      queueClaim,
      enrichmentId!,
      {
        website: website,
        industry: industry,
        resolution_status: companyResolutionStatus,
        resolution_score: companyResolutionScore,
        resolution_provenance: companyResolutionProvenance,
        resolution_technical_status: "completed",
        operational_profiles_count: resolvedOperationalProfiles,
        contact_resolution_measured_at: contactResolutionMeasuredAt,
        contact_candidates_resolved: contactResolutionCounts.resolved,
        contact_candidates_ambiguous: contactResolutionCounts.ambiguous,
        contact_candidates_rejected: contactResolutionCounts.rejected,
        raw_data: {
          source: "waterfall",
          outcome: "completed",
          siren: siren || null,
          dropcontact: dropcontactNote,
          dropcontact_request_id: dropcontactRequestId,
          company_resolution: {
            status: companyResolutionStatus,
            score: companyResolutionScore,
            provenance: companyResolutionProvenance,
          },
          contact_resolution_counts: contactResolutionCounts,
          contact_resolution_reason_counts: contactResolutionReasonCounts,
          contacts_total: contactRows.length,
          contacts_with_verified_email: withEmail,
          email_verification_counts: verificationStatusByIndex.reduce((counts, status) => {
            counts[status] = (counts[status] || 0) + 1;
            return counts;
          }, {} as Record<string, number>),
          queue_claim: queueClaim,
          completed_at: new Date().toISOString(),
        },
      },
      contactRows,
    );

    return new Response(JSON.stringify({
      success: true,
      provider: "waterfall",
      signal_id,
      enrichment_id: enrichmentId,
      contacts_inserted: insertedCount,
      contacts_with_verified_email: withEmail,
      dropcontact: dropcontactNote,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[enrich-contacts] Error:", msg);
    if (enrichmentId && activeSignalId && activeQueueClaim && !msg.startsWith("dispatch_fence_lost:")) {
      try {
        await updateEnrichmentDispatch(
          supabase,
          activeQueueClaim,
          enrichmentId,
          {
            status: "failed",
            enrichment_source: "waterfall",
            error_message: `Waterfall: ${msg}`.slice(0, 300),
            resolution_technical_status: "failed",
            operational_profiles_count: resolvedOperationalProfiles,
          },
          "failed",
        );
      } catch (persistError) {
        console.error(
          "[enrich-contacts] Fenced failure persistence rejected:",
          persistError instanceof Error ? persistError.message : persistError,
        );
      }
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  checkApifyRun,
  classifyOperationalPersonas,
  firstGivenName,
  getApifyDatasetWithUsage,
  normalizeCompanyName,
  parsePersonasSetting,
} from "../_shared/apify-linkedin.ts";
import {
  dropcontactBalanceMetadata,
  dropcontactEmailQualifications,
  dropcontactSubmissionKeys,
  findDropcontactResult,
  pickVerifiedEmail,
  pollDropcontactBatch,
  submitDropcontactBatch,
} from "../_shared/dropcontact.ts";
import {
  decideProviderDatasetRead,
  decideProviderTaskRecovery,
  operationGenerationFromRawData,
  shouldContinueDropcontactPolling,
} from "../_shared/enrichment-provider-budget.ts";
import { persistProviderUsage, persistProviderUsageOnce } from "../_shared/provider-usage.ts";

// ─────────────────────────────────────────────────────────────────────────────
// cron-check-linkedin-enrich — poller de la voie LinkedIn (v2). Appelé chaque minute.
//
// Étage A (status 'linkedin_processing') : la run Apify est-elle finie ?
//   -> SUCCEEDED : récupère le dataset, filtre les personas opérationnels, dédoublonne,
//      soumet Dropcontact, passe en 'dropcontact_processing'.
//   -> 0 profil opérationnel : 'failed' (entreprise trop petite / pas de cible) — visible.
//   -> FAILED/ABORTED : 'failed'. Une run lente reste pilotée par son statut fournisseur.
// Étage B (status 'dropcontact_processing') : les emails Dropcontact sont-ils prêts ?
//   -> oui : écrit les contacts (email vérifié quand trouvé), passe en 'completed'.
//   -> non terminal : conserve le job running et repolle au tick suivant.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH = 8;                  // enrichissements traités par tick
const APIFY_FINAL_COST_DELAY_MS = 10_000;
// Plafond de contacts vérifiés par entreprise. Un crédit Dropcontact par
// candidat, 500 par mois : sans plafond, trois grosses entreprises épuisent le
// solde du mois. Douze interlocuteurs, personas prioritaires d'abord, couvrent
// largement ce que l'opératrice travaille réellement sur une fiche.
const MAX_CONTACTS_PER_COMPANY = 12;

function norm(v: any): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || /^(n\/?a|na|-|null|none|undefined)$/i.test(t)) return null;
  return t;
}
interface EnrichmentQueueClaim {
  jobId: string;
  leaseToken: string;
}

const POLL_TOKEN_FIELD = "__enrichment_queue_poll_token";

function enrichmentQueueClaim(enr: any): EnrichmentQueueClaim | null {
  const claim = enr?.raw_data?.queue_claim;
  if (!claim || typeof claim !== "object") return null;
  if (typeof claim.job_id !== "string" || typeof claim.lease_token !== "string") return null;
  return { jobId: claim.job_id, leaseToken: claim.lease_token };
}

function enrichmentQueuePollToken(enr: any): string | null {
  return typeof enr?.[POLL_TOKEN_FIELD] === "string" ? enr[POLL_TOKEN_FIELD] : null;
}

async function claimLinkedJobPoll(supabase: any, enr: any): Promise<boolean> {
  const claim = enrichmentQueueClaim(enr);
  if (!claim) {
    console.error(`[cron-linkedin] queue claim absent pour enrichment ${enr?.id || "unknown"}`);
    return false;
  }
  const { data, error } = await supabase.rpc("claim_enrichment_job_poll", {
    p_job_id: claim.jobId,
    p_lease_token: claim.leaseToken,
    p_poll_seconds: 10 * 60,
    p_lease_seconds: 45 * 60,
  });
  if (error) throw new Error(`claim poll enrichment_jobs: ${error.message}`);
  if (typeof data !== "string" || !data) {
    console.warn(`[cron-linkedin] Job déjà pollé ou lease périmée pour ${claim.jobId}`);
    return false;
  }
  enr[POLL_TOKEN_FIELD] = data;
  return true;
}

async function releaseLinkedJobPoll(supabase: any, enr: any): Promise<void> {
  const claim = enrichmentQueueClaim(enr);
  const pollToken = enrichmentQueuePollToken(enr);
  if (!claim || !pollToken) return;
  const { error } = await supabase.rpc("release_enrichment_job_poll", {
    p_job_id: claim.jobId,
    p_lease_token: claim.leaseToken,
    p_poll_token: pollToken,
  });
  if (error) console.error(`[cron-linkedin] release poll job ${claim.jobId}: ${error.message}`);
}

interface LinkedInPollStateWrite {
  expectedStatus: "linkedin_processing" | "dropcontact_processing";
  newStatus?: "linkedin_processing" | "dropcontact_processing";
  resolutionAttemptedAt?: string;
  operationalProfilesCount?: number;
  contactResolutionMeasuredAt?: string;
  contactCandidatesResolved?: number;
  contactCandidatesAmbiguous?: number;
  contactCandidatesRejected?: number;
  rawData?: Record<string, unknown>;
}

async function updateLinkedInPollState(
  supabase: any,
  enr: any,
  write: LinkedInPollStateWrite,
): Promise<void> {
  const claim = enrichmentQueueClaim(enr);
  const pollToken = enrichmentQueuePollToken(enr);
  if (!claim || !pollToken) throw new Error(`poll claim absent pour enrichment ${enr.id}`);
  const { data, error } = await supabase.rpc("update_linkedin_enrichment_poll", {
    p_job_id: claim.jobId,
    p_lease_token: claim.leaseToken,
    p_poll_token: pollToken,
    p_enrichment_id: enr.id,
    p_expected_status: write.expectedStatus,
    p_new_status: write.newStatus ?? null,
    p_resolution_attempted_at: write.resolutionAttemptedAt ?? null,
    p_operational_profiles_count: write.operationalProfilesCount ?? null,
    p_contact_resolution_measured_at: write.contactResolutionMeasuredAt ?? null,
    p_contact_candidates_resolved: write.contactCandidatesResolved ?? null,
    p_contact_candidates_ambiguous: write.contactCandidatesAmbiguous ?? null,
    p_contact_candidates_rejected: write.contactCandidatesRejected ?? null,
    p_raw_data: write.rawData ?? null,
  });
  if (error) throw new Error(`mutation poll LinkedIn: ${error.message}`);
  if (data !== true) throw new Error(`poll_fence_lost:${claim.jobId}`);
}

interface LinkedInTerminalWrite {
  status: "completed" | "failed";
  technicalStatus: "completed" | "failed";
  operationalProfilesCount: number;
  rawData: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  result: Record<string, unknown>;
  errorMessage?: string | null;
}

async function finalizeLinkedInEnrichment(
  supabase: any,
  enr: any,
  write: LinkedInTerminalWrite,
): Promise<number> {
  const claim = enrichmentQueueClaim(enr);
  if (!claim) throw new Error(`queue claim absent pour enrichment ${enr.id}`);
  const pollToken = enrichmentQueuePollToken(enr);
  if (!pollToken) throw new Error(`poll token absent pour job ${claim.jobId}`);
  const { data, error } = await supabase.rpc("finalize_linkedin_enrichment_poll", {
    p_job_id: claim.jobId,
    p_lease_token: claim.leaseToken,
    p_poll_token: pollToken,
    p_enrichment_id: enr.id,
    p_signal_id: enr.signal_id,
    p_status: write.status,
    p_resolution_attempted_at: enr.resolution_attempted_at || enr.raw_data?.started_at || new Date().toISOString(),
    p_resolution_technical_status: write.technicalStatus,
    p_operational_profiles_count: write.operationalProfilesCount,
    p_company_raw_data: write.rawData,
    p_contacts: write.contacts || [],
    p_error_message: write.errorMessage || null,
    p_result: {
      submission_status: write.status,
      enrichment_id: enr.id,
      provider: enr?.raw_data?.source === "waterfall" ? "waterfall" : "linkedin",
      ...write.result,
    },
  });
  if (error) throw new Error(`finalisation LinkedIn transactionnelle: ${error.message}`);
  const result = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (result.accepted !== true) {
    throw new Error(`poll_fence_lost:${claim.jobId}`);
  }
  return typeof result.contacts_inserted === "number" ? result.contacts_inserted : 0;
}

async function markFailed(
  supabase: any,
  enr: any,
  reason: string,
  outcome: string,
  details: Record<string, unknown> = {},
  technicalStatus: "completed" | "failed" = "failed",
  operationalProfilesCount = 0,
) {
  await finalizeLinkedInEnrichment(supabase, enr, {
    status: "failed",
    technicalStatus,
    operationalProfilesCount,
    rawData: { ...(enr.raw_data || {}), ...details, outcome, failed_at: new Date().toISOString() },
    result: { outcome },
    errorMessage: reason.slice(0, 300),
  });
}

interface ContactWriteResult {
  total: number;
  inserted: number;
  verified: number;
  rejected: number;
  not_found: number;
  not_attempted: number;
  rows: Array<Record<string, unknown>>;
}

// Écrit uniquement les contacts résolus. Les résultats Dropcontact sont reliés via custom_fields
// (fallback identité unique pour les anciens lots), jamais par un zip d'index aveugle.
function buildContacts(
  enr: any,
  candidates: any[],
  dcData: any[],
  verificationCompleted: boolean,
): ContactWriteResult {
  const workflowSource = enr?.raw_data?.source === "waterfall" ||
      enr?.enrichment_source === "waterfall"
    ? "waterfall"
    : "linkedin";
  const seen = new Set<string>();
  const counts: ContactWriteResult = {
    total: 0,
    inserted: 0,
    verified: 0,
    rejected: 0,
    not_found: 0,
    not_attempted: 0,
    rows: [],
  };
  const rows = candidates.map((c) => {
    const res = findDropcontactResult(
      dcData,
      c.dropcontact_candidate_id,
      { first_name: c.first_name, last_name: c.last_name },
    );
    const verified = pickVerifiedEmail(res?.email);
    const qualifications = dropcontactEmailQualifications(res?.email);
    const emailStatus = verified
      ? "verified"
      : !verificationCompleted
      ? "not_attempted"
      : Array.isArray(res?.email) && res.email.length > 0
      ? "rejected"
      : "not_found";
    counts[emailStatus as "verified" | "rejected" | "not_found" | "not_attempted"]++;
    const full_name = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
    return {
      enrichment_id: enr.id,
      signal_id: enr.signal_id,
      full_name,
      first_name: c.first_name,
      last_name: c.last_name,
      job_title: c.job_title,
      department: null,
      location: c.location || null,
      email_principal: verified?.email || null,
      email_alternatif: null,
      phone: norm(res?.phone) || norm(res?.mobile_phone),
      linkedin_url: c.linkedin_url || null,
      is_priority_target: typeof c.is_priority_target === "boolean"
        ? c.is_priority_target
        : c.persona_priority === true,
      priority_score: typeof c.priority_score === "number"
        ? c.priority_score
        : c.persona_priority === true
        ? 5
        : 4,
      outreach_status: "new",
      resolution_status: c.resolution_status || "resolved",
      resolution_score: c.resolution_score ?? 100,
      resolution_provenance: c.resolution_provenance || {
        provider: "apify",
        actor: "harvestapi/linkedin-company-employees",
      },
      email_verification_status: emailStatus,
      email_verification_provider: verificationCompleted ? "dropcontact" : null,
      email_verification_qualification: verified?.qualification || qualifications[0] || null,
      email_verification_confidence: verified?.confidence ?? null,
      email_verified_at: verified ? new Date().toISOString() : null,
      email_verification_provenance: {
        provider: verificationCompleted ? "dropcontact" : null,
        request_id: enr.raw_data?.dropcontact_request_id || null,
        candidate_id: c.dropcontact_candidate_id,
        status: emailStatus,
        qualifications,
        provider_result_matched: Boolean(res),
        quantitative_confidence_supplied: false,
      },
      raw_data: {
        source: workflowSource,
        contact_source: c.source || `${workflowSource}+dropcontact`,
        persona_name: c.persona_name || null,
        persona_priority: c.persona_priority === true,
        email_status: emailStatus,
        email_provider: verificationCompleted ? "dropcontact" : null,
        email_qualifications: qualifications,
      },
    };
  }).filter((r) => {
    if (!r.full_name) return false;
    const key = (r.linkedin_url || `${r.first_name}|${r.last_name}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  counts.total = rows.length;
  counts.rows = rows;
  return counts;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const APIFY_API_KEY = Deno.env.get("APIFY_API_KEY") || "";
  let DROPCONTACT_API_KEY = Deno.env.get("DROPCONTACT_API_KEY") || "";
  let providerSettingsError: string | null = null;
  if (!DROPCONTACT_API_KEY) {
    const { data, error } = await supabase.from("settings").select("value").eq("key", "dropcontact_api_key").maybeSingle();
    if (error) providerSettingsError = `read Dropcontact setting: ${error.message}`;
    DROPCONTACT_API_KEY = data?.value || "";
  }

  const summary = { apify_checked: 0, dropcontact_done: 0, contacts_written: 0, failed: 0 };
  let activeEnrichment: any = null;
  let activeOperationalProfiles = 0;

  try {
    // ── Étage A : runs Apify en cours ─────────────────────────────────────────
    const { data: aRows, error: aRowsError } = await supabase
      .from("company_enrichment").select("*").eq("status", "linkedin_processing")
      .order("updated_at", { ascending: true }).limit(BATCH);
    if (aRowsError) throw new Error(`read linkedin_processing: ${aRowsError.message}`);

    for (const enr of aRows || []) {
      const rd = enr.raw_data || {};
      if (!await claimLinkedJobPoll(supabase, enr)) continue;
      activeEnrichment = enr;
      activeOperationalProfiles = 0;
      let pollErrored = false;
      try {
        await updateLinkedInPollState(supabase, enr, {
          expectedStatus: "linkedin_processing",
          resolutionAttemptedAt: enr.resolution_attempted_at || rd.started_at || new Date().toISOString(),
          operationalProfilesCount: 0,
        });
      summary.apify_checked++;
      if (!rd.apify_run_id || !APIFY_API_KEY) {
        await markFailed(supabase, enr, "Run Apify introuvable ou clé absente.", "apify_missing");
        summary.failed++;
        continue;
      }
      const pollEventId = crypto.randomUUID();
      const run = await checkApifyRun(APIFY_API_KEY, rd.apify_run_id, async (usage) => {
        await persistProviderUsage(supabase, {
          provider: "apify",
          operation: usage.operation,
          requestKey: `apify:actor_run_poll:${rd.apify_run_id}:${pollEventId}`,
          signalId: enr.signal_id,
          runId: enr.id,
          success: usage.success,
          units: 0,
          itemsCount: usage.itemsCount,
          httpStatus: usage.httpStatus,
          errorCode: usage.errorCode,
          metadata: {
            provider_request_id: usage.providerRequestId,
            unit_basis: "not_returned_by_provider",
          },
        });
      });
      if (run.status === "LEDGER_ERROR") {
        await markFailed(supabase, enr, "Ledger Apify non persisté après poll.", "apify_ledger_error");
        summary.failed++;
        continue;
      }
      if (run.status === "RUNNING" || run.status === "READY" || run.status === "UNKNOWN") continue; // pas prêt, tick suivant

      // Apify documente une cohérence éventuelle des totaux USD : on laisse le
      // cron suivant relire la run au moins 10 s après sa fin avant de figer le
      // coût. L'événement stable par run évite tout double comptage après crash.
      const finishedAtMs = run.finishedAt ? new Date(run.finishedAt).getTime() : Number.NaN;
      const terminalObservedAt = typeof rd.apify_terminal_observed_at === "string"
        ? new Date(rd.apify_terminal_observed_at).getTime()
        : Number.NaN;
      const costStableSince = Number.isFinite(finishedAtMs) ? finishedAtMs : terminalObservedAt;
      if (!Number.isFinite(costStableSince)) {
        await updateLinkedInPollState(supabase, enr, {
          expectedStatus: "linkedin_processing",
          rawData: { ...rd, apify_terminal_observed_at: new Date().toISOString() },
        });
        continue;
      }
      if (Date.now() - costStableSince < APIFY_FINAL_COST_DELAY_MS) continue;

      if (run.usageTotalUsd !== null) {
        await persistProviderUsageOnce(supabase, {
          provider: "apify",
          operation: "actor_run_cost",
          requestKey: `apify:actor_run_cost:${rd.apify_run_id}`,
          signalId: enr.signal_id,
          runId: enr.id,
          success: run.status === "SUCCEEDED",
          units: 1,
          requestsCount: 0,
          itemsCount: 0,
          costAmount: run.usageTotalUsd,
          currency: "USD",
          costSource: "provider_api",
          metadata: {
            provider_request_id: rd.apify_run_id,
            unit_basis: "actor_run",
            provider_reported_field: "usageTotalUsd",
            finished_at: run.finishedAt,
          },
        });
      }
      if (run.status !== "SUCCEEDED") {
        await markFailed(supabase, enr, `Run LinkedIn ${run.status}.`, "apify_" + run.status.toLowerCase());
        summary.failed++;
        continue;
      }

      const datasetId = run.datasetId || rd.apify_dataset_id;
      if (!datasetId) {
        await markFailed(supabase, enr, "Dataset Apify absent après succès de la run.", "apify_dataset_missing");
        summary.failed++;
        continue;
      }
      const datasetRequestKey = `apify:dataset_items:${datasetId}`;
      const { data: priorDatasetUsage, error: datasetPreflightError } = await supabase
        .from("provider_usage_events")
        .select("metadata")
        .eq("provider", "apify")
        .eq("request_key", datasetRequestKey)
        .maybeSingle();
      if (datasetPreflightError) {
        await markFailed(
          supabase,
          enr,
          "Ledger Apify illisible avant dataset.",
          "apify_ledger_preflight_error",
        );
        summary.failed++;
        continue;
      }
      const datasetDecision = decideProviderDatasetRead(
        datasetId,
        priorDatasetUsage ? [priorDatasetUsage] : [],
      );
      if (datasetDecision.kind === "blocked") {
        await markFailed(
          supabase,
          enr,
          `Preuve dataset Apify ambiguë (${datasetDecision.reason}).`,
          "apify_dataset_proof_ambiguous",
        );
        summary.failed++;
        continue;
      }
      const datasetUsageRequestKey = datasetDecision.reason === "first_read"
        ? datasetRequestKey
        : `${datasetRequestKey}:replay:${crypto.randomUUID()}`;
      const dataset = await getApifyDatasetWithUsage(APIFY_API_KEY, datasetId, async (usage) => {
        await persistProviderUsage(supabase, {
          provider: "apify",
          operation: usage.operation,
          requestKey: datasetUsageRequestKey,
          signalId: enr.signal_id,
          runId: enr.id,
          success: usage.success,
          units: 0,
          itemsCount: usage.itemsCount,
          httpStatus: usage.httpStatus,
          errorCode: usage.errorCode,
          metadata: {
            provider_request_id: usage.providerRequestId,
            unit_basis: "not_returned_by_provider",
          },
        });
      });
      if (dataset.usageError || !dataset.requestSucceeded) {
        await markFailed(
          supabase,
          enr,
          dataset.usageError ? "Ledger Apify non persisté après lecture dataset." : "Lecture dataset Apify échouée.",
          dataset.usageError ? "apify_ledger_error" : "apify_dataset_fetch_error",
        );
        summary.failed++;
        continue;
      }
      const items = dataset.items;
      const personas = parsePersonasSetting(rd.personas_requested);
      const classified = classifyOperationalPersonas(items, personas);
      const contactResolutionReasonCounts = classified.decisions.reduce((counts, decision) => {
        const reason = typeof decision.resolution_provenance?.reason === "string"
          ? decision.resolution_provenance.reason
          : "unknown";
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {} as Record<string, number>);
      // Chaque candidat retenu coûte un crédit Dropcontact. Une entreprise qui
      // ramène 100 profils peut donc en consommer 70 à elle seule — mesuré le
      // 2026-08-21, quand la reconnaissance des intitulés est passée de 32 % à
      // 73 %. Le solde mensuel (500) partirait sur trois entreprises.
      //
      // On garde donc les MEILLEURS, pas les premiers arrivés : personas
      // prioritaires d'abord, puis score de résolution. L'opératrice travaille
      // quelques interlocuteurs par entreprise, pas soixante-dix.
      const ranked = [...classified.resolved].sort((a, b) => {
        const priority = Number(b.persona_priority === true) - Number(a.persona_priority === true);
        if (priority !== 0) return priority;
        return (b.resolution_score ?? 0) - (a.resolution_score ?? 0);
      });
      const candidates = ranked.slice(0, MAX_CONTACTS_PER_COMPANY).map((candidate, index) => ({
        ...candidate,
        dropcontact_candidate_id: `${enr.id}:${index}`,
      }));
      // Un plafond muet se lit comme « il n'y avait que ça ». On écrit ce qui a
      // été écarté, pour que le chiffre reste explicable.
      const candidatesDropped = ranked.length - candidates.length;
      if (candidatesDropped > 0) {
        console.log(
          `[cron-linkedin] ${enr.company_name}: ${ranked.length} profils retenus, ` +
            `${candidates.length} envoyés à Dropcontact, ${candidatesDropped} écartés (plafond).`,
        );
      }
      await updateLinkedInPollState(supabase, enr, {
        expectedStatus: "linkedin_processing",
        resolutionAttemptedAt: enr.resolution_attempted_at || rd.started_at || new Date().toISOString(),
        contactResolutionMeasuredAt: new Date().toISOString(),
        contactCandidatesResolved: classified.counts.resolved,
        contactCandidatesAmbiguous: classified.counts.ambiguous,
        contactCandidatesRejected: classified.counts.rejected,
      });

      if (candidates.length === 0) {
        await markFailed(
          supabase, enr,
          `Aucun profil opérationnel résolu sur LinkedIn (${items.length} profils examinés).`,
          classified.counts.ambiguous > 0 ? "operational_profiles_ambiguous" : "no_operational_profiles",
          {
            contact_resolution_counts: classified.counts,
            contact_resolution_reason_counts: contactResolutionReasonCounts,
            employees_scanned: items.length,
          },
          "completed",
          0,
        );
        summary.failed++;
        continue;
      }
      activeOperationalProfiles = candidates.length;

      // Soumet Dropcontact pour vérifier les emails (prénom nettoyé).
      const dcInputs = candidates.map((c) => ({
        first_name: firstGivenName(c.first_name) || undefined,
        last_name: c.last_name || undefined,
        company: normalizeCompanyName(enr.company_name || "") || undefined,
        linkedin: c.linkedin_url || undefined,
        company_linkedin: enr.linkedin_company_url || undefined,
        job: c.job_title || undefined,
        custom_fields: { gourrmet_candidate_id: c.dropcontact_candidate_id },
      }));
      let outcome = "dropcontact_pending";
      let dropcontact_request_id: string | null = null;
      let dropcontact_submitted_at = new Date().toISOString();
      if (providerSettingsError) {
        await markFailed(
          supabase,
          enr,
          providerSettingsError,
          "dropcontact_configuration_read_error",
          {},
          "failed",
          candidates.length,
        );
        summary.failed++;
        continue;
      }
      if (DROPCONTACT_API_KEY) {
        const operationGeneration = operationGenerationFromRawData(rd);
        if (!operationGeneration) {
          await markFailed(
            supabase,
            enr,
            "Génération fournisseur absente avant soumission Dropcontact.",
            "operation_generation_missing",
            {},
            "failed",
            candidates.length,
          );
          summary.failed++;
          continue;
        }
        const { requestKey: submitRequestKey } = dropcontactSubmissionKeys(
          operationGeneration,
        );
        const { data: priorSubmit, error: submitPreflightError } = await supabase
          .from("provider_usage_events")
          .select("metadata, occurred_at")
          .eq("provider", "dropcontact")
          .eq("request_key", submitRequestKey)
          .maybeSingle();
        if (submitPreflightError) {
          await markFailed(
            supabase,
            enr,
            "Ledger Dropcontact illisible avant soumission.",
            "dropcontact_ledger_preflight_error",
            {},
            "failed",
            candidates.length,
          );
          summary.failed++;
          continue;
        }
        const dropcontactDecision = decideProviderTaskRecovery({
          localTaskId: rd.dropcontact_request_id,
          priorLedgerRows: priorSubmit ? [priorSubmit] : [],
          isRetry: ["submitting", "processing"].includes(
            typeof rd.dropcontact_submission_state === "string"
              ? rd.dropcontact_submission_state
              : "",
          ),
        });
        if (dropcontactDecision.kind === "blocked") {
          await markFailed(
            supabase,
            enr,
            `Preuve Dropcontact ambiguë (${dropcontactDecision.reason}).`,
            "dropcontact_submit_proof_ambiguous",
            {},
            "failed",
            candidates.length,
          );
          summary.failed++;
          continue;
        }
        if (dropcontactDecision.kind === "reuse") {
          dropcontact_request_id = dropcontactDecision.taskId;
          dropcontact_submitted_at = priorSubmit?.occurred_at || dropcontact_submitted_at;
        } else {
          // Le fence et l'intention sont durables AVANT le POST. Si le process
          // meurt ensuite sans ledger, le tick suivant échoue fermé au lieu de
          // risquer une seconde soumission payante.
          await updateLinkedInPollState(supabase, enr, {
            expectedStatus: "linkedin_processing",
            operationalProfilesCount: candidates.length,
            rawData: {
              ...rd,
              outcome: "dropcontact_submitting",
              dropcontact_submission_state: "submitting",
              employees_scanned: items.length,
              contact_resolution_counts: classified.counts,
              contact_resolution_reason_counts: contactResolutionReasonCounts,
              candidates,
            },
          });
          const sub = await submitDropcontactBatch(DROPCONTACT_API_KEY, dcInputs, {
            supabase,
            enrichmentId: enr.id,
            operationGeneration,
            signalId: enr.signal_id,
            metadata: { source: "linkedin" },
          });
          if ("request_id" in sub) dropcontact_request_id = sub.request_id;
          else if (sub.ledger_error || sub.uncertain) {
            await markFailed(
              supabase,
              enr,
              "Soumission Dropcontact sans résultat récupérable ; réconciliation requise.",
              "dropcontact_submit_outcome_uncertain",
              {},
              "failed",
              candidates.length,
            );
            summary.failed++;
            continue;
          } else {
            outcome = "dropcontact_submit_error";
            console.warn("[cron-linkedin]", sub.error);
          }
        }
      } else {
        outcome = "dropcontact_not_configured";
      }

      if (!dropcontact_request_id) {
        // Pas de vérif email possible : on écrit quand même les profils (noms + LinkedIn).
        const written = buildContacts(enr, candidates, [], false);
        const terminalRawData = {
          ...rd,
          outcome,
          employees_scanned: items.length,
          contact_resolution_counts: classified.counts,
          contact_resolution_reason_counts: contactResolutionReasonCounts,
          contacts_total: written.total,
          contacts_with_verified_email: written.verified,
          email_verification_counts: {
            verified: written.verified,
            rejected: written.rejected,
            not_found: written.not_found,
            not_attempted: written.not_attempted,
          },
          completed_at: new Date().toISOString(),
        };
        written.inserted = await finalizeLinkedInEnrichment(supabase, enr, {
          status: "completed",
          technicalStatus: "completed",
          operationalProfilesCount: candidates.length,
          rawData: terminalRawData,
          contacts: written.rows,
          result: {
            outcome,
            contacts_total: written.total,
            contacts_with_verified_email: written.verified,
          },
        });
        summary.contacts_written += written.inserted;
        continue;
      }

      await updateLinkedInPollState(supabase, enr, {
        expectedStatus: "linkedin_processing",
        newStatus: "dropcontact_processing",
        operationalProfilesCount: candidates.length,
        rawData: {
          ...rd,
          outcome: "dropcontact_pending",
          dropcontact_submission_state: "processing",
          dropcontact_request_id,
          employees_scanned: items.length,
          contact_resolution_counts: classified.counts,
          contact_resolution_reason_counts: contactResolutionReasonCounts,
          candidates,
          dropcontact_submitted_at,
        },
      });
      } catch (error) {
        pollErrored = true;
        throw error;
      } finally {
        if (!pollErrored) {
          await releaseLinkedJobPoll(supabase, enr);
          activeEnrichment = null;
          activeOperationalProfiles = 0;
        }
      }
    }

    // ── Étage B : lots Dropcontact en cours ───────────────────────────────────
    const { data: bRows, error: bRowsError } = await supabase
      .from("company_enrichment").select("*").eq("status", "dropcontact_processing")
      .order("updated_at", { ascending: true }).limit(BATCH);
    if (bRowsError) throw new Error(`read dropcontact_processing: ${bRowsError.message}`);

    for (const enr of bRows || []) {
      const rd = enr.raw_data || {};
      const candidates: any[] = Array.isArray(rd.candidates) ? rd.candidates : [];
      const isWaterfall = rd.source === "waterfall" || enr.enrichment_source === "waterfall";
      if (!await claimLinkedJobPoll(supabase, enr)) continue;
      activeEnrichment = enr;
      activeOperationalProfiles = candidates.length;
      let pollErrored = false;
      try {
        await updateLinkedInPollState(supabase, enr, {
          expectedStatus: "dropcontact_processing",
          resolutionAttemptedAt: enr.resolution_attempted_at || rd.started_at || new Date().toISOString(),
          operationalProfilesCount: candidates.length,
        });
      if (candidates.length === 0) {
        await markFailed(
          supabase,
          enr,
          "Candidats durables absents pour reprendre Dropcontact.",
          "dropcontact_candidates_missing",
        );
        summary.failed++;
        continue;
      }
      if (providerSettingsError) {
        await markFailed(
          supabase,
          enr,
          providerSettingsError,
          "dropcontact_configuration_read_error",
          {},
          "failed",
          candidates.length,
        );
        summary.failed++;
        continue;
      }

      let dcData: any[] = [];
      let verificationCompleted = false;
      if (rd.dropcontact_request_id && DROPCONTACT_API_KEY) {
        const pollEventId = crypto.randomUUID();
        const polled = await pollDropcontactBatch(
          DROPCONTACT_API_KEY,
          rd.dropcontact_request_id,
          { maxAttempts: 1, delayMs: 500 },
          async (usage) => {
            await persistProviderUsage(supabase, {
              provider: "dropcontact",
              operation: usage.operation,
              requestKey: `dropcontact:enrich_poll:${rd.dropcontact_request_id}:${pollEventId}:${usage.attempt}`,
              signalId: enr.signal_id,
              runId: enr.id,
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
          },
        );
        if ("data" in polled) {
          dcData = polled.data;
          verificationCompleted = true;
        }
        else if (polled.ledger_error) {
          await markFailed(
            supabase,
            enr,
            "Ledger Dropcontact non persisté après poll.",
            "dropcontact_ledger_error",
            {},
            "failed",
            candidates.length,
          );
          summary.failed++;
          continue;
        } else if (shouldContinueDropcontactPolling(false)) continue;
      } else if (isWaterfall) {
        await markFailed(
          supabase,
          enr,
          "Lot Dropcontact waterfall introuvable ou clé absente.",
          "dropcontact_resume_proof_missing",
          {},
          "failed",
          candidates.length,
        );
        summary.failed++;
        continue;
      }

      const written = buildContacts(enr, candidates, dcData, verificationCompleted);
      const terminalOutcome = verificationCompleted ? "completed" : "completed_without_verification";
      const terminalRawData = {
        ...rd,
        outcome: terminalOutcome,
        contacts_total: written.total,
        contacts_with_verified_email: written.verified,
        email_verification_counts: {
          verified: written.verified,
          rejected: written.rejected,
          not_found: written.not_found,
          not_attempted: written.not_attempted,
        },
        completed_at: new Date().toISOString(),
      };
      written.inserted = await finalizeLinkedInEnrichment(supabase, enr, {
        status: "completed",
        technicalStatus: "completed",
        operationalProfilesCount: candidates.length,
        rawData: terminalRawData,
        contacts: written.rows,
        result: {
          outcome: terminalOutcome,
          contacts_total: written.total,
          contacts_with_verified_email: written.verified,
        },
      });
        summary.dropcontact_done++;
        summary.contacts_written += written.inserted;
      } catch (error) {
        pollErrored = true;
        throw error;
      } finally {
        if (!pollErrored) {
          await releaseLinkedJobPoll(supabase, enr);
          activeEnrichment = null;
          activeOperationalProfiles = 0;
        }
      }
    }

    return new Response(JSON.stringify(summary), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown";
    console.error("[cron-check-linkedin-enrich] Error:", errorMessage);
    if (activeEnrichment?.id) {
      try {
        await markFailed(
          supabase,
          activeEnrichment,
          `Poller LinkedIn: ${errorMessage}`,
          "poller_exception",
          { poller_error: errorMessage.slice(0, 300) },
          "failed",
          activeOperationalProfiles,
        );
      } catch (terminalError) {
        console.error(
          "[cron-check-linkedin-enrich] Échec finalisation fenced:",
          terminalError instanceof Error ? terminalError.message : terminalError,
        );
      } finally {
        await releaseLinkedJobPoll(supabase, activeEnrichment);
      }
    }
    return new Response(JSON.stringify({ error: errorMessage, ...summary }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

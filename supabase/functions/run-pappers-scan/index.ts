import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireInternalAccess } from "../_shared/internal-auth.ts";
import {
  parsePappersAction,
  PAPPERS_DEFAULT_MONTHLY_CREDITS,
  PAPPERS_RUN_LEASE_SECONDS,
  PappersTransitionConflictError,
  requirePappersMutation,
  isPappersTransitionConflictCode,
  transitionPappersStatus,
  type PappersControlAction,
  type PappersObservedScanStatus,
  type PappersScanStatus,
} from "../_shared/pappers-engine.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
} | undefined;

class PappersRunRequestError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus = 422) {
    super(message);
    this.name = 'PappersRunRequestError';
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function statusPayload(supabase: any) {
  const [{ data: quota, error: quotaError }, { data: recentScans, error: scansError }] = await Promise.all([
    supabase.rpc('get_pappers_quota_status'),
    supabase.from('pappers_scan_progress').select('*').order('created_at', { ascending: false }).limit(20),
  ]);
  if (quotaError || !quota) throw new Error(`Usage Pappers illisible: ${quotaError?.message || 'réponse vide'}`);
  if (scansError) throw new Error(`Runs Pappers illisibles: ${scansError.message}`);
  return {
    recentScans: recentScans || [],
    credits: {
      used: Number(quota.used ?? 0),
      reserved: Number(quota.reserved ?? 0),
      committed: Number(quota.committed ?? 0),
      limit: Number(quota.effective_limit ?? PAPPERS_DEFAULT_MONTHLY_CREDITS),
      configuredLimit: Number(quota.configured_limit ?? 0),
      remaining: Number(quota.remaining ?? 0),
      percent: Number(quota.percent ?? 100),
      source: quota.source,
      periodStart: quota.period_start,
      periodEnd: quota.period_end,
      periodCurrent: quota.period_current === true,
    },
  };
}

async function loadScan(supabase: any, scanId: string) {
  const { data, error } = await supabase
    .from('pappers_scan_progress')
    .select('*')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw new Error(`Scan Pappers illisible: ${error.message}`);
  if (!data) {
    throw new PappersRunRequestError('pappers_scan_not_found', `Scan Pappers introuvable: ${scanId}`, 404);
  }
  return data;
}

async function observeScan(supabase: any, scanId: string) {
  const { data, error } = await supabase
    .from('pappers_scan_progress')
    .select('id,status')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw new Error(`État Pappers illisible: ${error.message}`);
  return data as { id: string; status: PappersScanStatus } | null;
}

async function observeActiveScan(supabase: any) {
  const { data, error } = await supabase
    .from('pappers_scan_progress')
    .select('id,status')
    .in('status', ['pending', 'running', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`État Pappers actif illisible: ${error.message}`);
  return data as { id: string; status: PappersScanStatus } | null;
}

function observedStatus(scan: { status: PappersScanStatus } | null): PappersObservedScanStatus {
  return scan?.status || 'missing';
}

function isReconciliationRequired(error: { code?: unknown; message?: unknown } | null | undefined) {
  return error?.code === '55000' && /réconciliation/i.test(String(error.message || ''));
}

async function throwTransitionConflict(
  supabase: any,
  action: Exclude<PappersControlAction, 'status'>,
  scanId: string | null,
): Promise<never> {
  const current = scanId ? await observeScan(supabase, scanId) : await observeActiveScan(supabase);
  throw new PappersTransitionConflictError(
    action,
    scanId || current?.id || null,
    observedStatus(current),
  );
}

async function assertRunnablePlan(supabase: any) {
  const { data: plan, error } = await supabase.from('pappers_plan_settings').select('*').single();
  if (error || !plan) throw new Error(`Plan Pappers absent ou illisible: ${error?.message || 'réponse vide'}`);
  const limit = Number(plan.monthly_credits);
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('Plan Pappers non configuré (quota à 0)');
  const today = new Date().toISOString().slice(0, 10);
  if (today < plan.current_period_start || today > plan.current_period_end) {
    throw new Error(`Période Pappers non courante: ${plan.current_period_start} - ${plan.current_period_end}`);
  }
}

async function assertRunnableQueries(supabase: any, queryId?: string) {
  let request = supabase
    .from('pappers_queries')
    .select('id,type,is_active');
  request = queryId ? request.eq('id', queryId) : request.eq('is_active', true);
  const { data, error } = await request;
  if (error) throw new Error(`Requêtes Pappers illisibles: ${error.message}`);
  const queries = data || [];
  if (queries.length === 0) {
    throw new PappersRunRequestError(
      queryId ? 'pappers_query_not_found' : 'no_active_pappers_queries',
      queryId ? 'Requête Pappers introuvable' : 'Aucune requête Pappers active à exécuter',
    );
  }

  const publicationTypes = queries
    .filter((query: { type: string }) => ['nomination', 'capital_increase', 'transfer'].includes(query.type))
    .map((query: { type: string }) => query.type);
  if (publicationTypes.length > 0) {
    throw new PappersRunRequestError(
      'unsupported_without_company_identity',
      `Requêtes Pappers non prises en charge sans identité société garantie: ${[...new Set(publicationTypes)].join(', ')}`,
    );
  }

  const unknownTypes = queries
    .filter((query: { type: string }) => !['anniversary', 'creation'].includes(query.type))
    .map((query: { type: string }) => query.type);
  if (unknownTypes.length > 0) {
    throw new PappersRunRequestError(
      'unsupported_query_type',
      `Types de requête Pappers inconnus: ${[...new Set(unknownTypes)].join(', ')}`,
    );
  }
  if (queryId && queries[0]?.is_active !== true) {
    throw new PappersRunRequestError('pappers_query_inactive', 'Cette requête Pappers est désactivée');
  }
}

async function controlScan(
  supabase: any,
  scanId: string,
  action: 'pause' | 'stop',
) {
  const scan = await loadScan(supabase, scanId);
  let next: PappersScanStatus;
  try {
    next = transitionPappersStatus(scan.status as PappersScanStatus, action);
  } catch {
    throw new PappersTransitionConflictError(action, scanId, scan.status as PappersScanStatus);
  }
  const update: Record<string, unknown> = {
    status: next,
    error_message: action === 'stop' ? 'Scan arrêté manuellement' : null,
    lease_token: null,
    lease_expires_at: null,
  };
  if (next === 'cancelled') update.completed_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('pappers_scan_progress')
    .update(update)
    .eq('id', scanId)
    .eq('status', scan.status)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`Transition Pappers non persistée: ${error.message}`);
  if (!data) {
    const current = await observeScan(supabase, scanId);
    return requirePappersMutation(data, {
      action,
      scanId,
      currentStatus: observedStatus(current),
    });
  }
  return data;
}

async function invokeEngine(input: {
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
    body: JSON.stringify({ scanId: input.scanId, leaseToken: input.leaseToken, queryId: input.queryId }),
  });
  const body = await response.text();
  if (!response.ok && response.status !== 202) {
    throw new Error(`Moteur Pappers HTTP ${response.status}: ${body.slice(0, 1_000)}`);
  }
  return body;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const access = await requireInternalAccess(req, { responseHeaders: corsHeaders });
  if (!access.ok) return access.response;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ success: false, error: 'Configuration Supabase absente' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const action = parsePappersAction(body.action);

    if (action === 'status') return json({ success: true, ...(await statusPayload(supabase)) });

    if (action === 'pause' || action === 'stop') {
      if (!body.scanId) return json({ success: false, error: 'scanId requis' }, 400);
      const scan = await controlScan(supabase, body.scanId, action);
      return json({ success: true, status: scan.status, scanId: body.scanId });
    }

    if (body.dryRun === true) {
      const { count, error } = await supabase
        .from('pappers_queries')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      if (error) throw new Error(`Requêtes Pappers illisibles: ${error.message}`);
      return json({
        success: true,
        dryRun: true,
        status: 'simulated',
        queriesToProcess: count || 0,
        message: 'Simulation locale: aucun appel Pappers effectué et aucun crédit consommé.',
      });
    }

    let scanId = body.scanId as string | undefined;
    let engineQueryId = body.queryId as string | undefined;
    let leaseToken: string | undefined;
    if (action === 'recover') {
      const { data, error } = await supabase.rpc('recover_pappers_scan', {
        p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
      });
      if (error) {
        throw new PappersRunRequestError(
          'pappers_recovery_failed',
          `Impossible de récupérer le scan: ${error.message}`,
          500,
        );
      }
      if (data?.status === 'idle') {
        return json({ success: true, status: 'idle', recovered: false });
      }
      if (data?.status === 'reconciliation_required') {
        return json({
          success: false,
          status: 'reconciliation_required',
          code: 'pappers_request_reconciliation_required',
          scanId: data.scan_id || null,
          error: 'Un appel Pappers envoyé sans réponse durable doit être réconcilié manuellement.',
        }, 409);
      }
      if (!data?.scan_id || !data?.lease_token) {
        throw new PappersRunRequestError(
          'pappers_recovery_empty_result',
          'Impossible de récupérer le scan: réponse vide',
          500,
        );
      }
      scanId = data.scan_id;
      leaseToken = data.lease_token;
      engineQueryId = data.query_id || undefined;
    } else if (action === 'resume') {
      if (!scanId) return json({ success: false, error: 'scanId requis' }, 400);
      const { data, error } = await supabase.rpc('resume_pappers_scan', {
        p_scan_id: scanId,
        p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
      });
      if (error) {
        if (isReconciliationRequired(error)) {
          return json({
            success: false,
            status: 'reconciliation_required',
            code: 'pappers_request_reconciliation_required',
            scanId,
            error: error.message,
          }, 409);
        }
        if (isPappersTransitionConflictCode(error.code)) {
          await throwTransitionConflict(supabase, action, scanId);
        }
        if (error.code === 'P0002') {
          throw new PappersRunRequestError('pappers_scan_not_found', `Scan Pappers introuvable: ${scanId}`, 404);
        }
        throw new PappersRunRequestError(
          'pappers_resume_failed',
          `Impossible de reprendre le scan: ${error.message}`,
          500,
        );
      }
      if (!data?.lease_token) {
        await throwTransitionConflict(supabase, action, scanId);
      }
      leaseToken = data.lease_token;
      engineQueryId = data.query_id || undefined;
    } else {
      await assertRunnablePlan(supabase);
      await assertRunnableQueries(supabase, body.queryId);
      const { data, error } = await supabase.rpc('start_pappers_scan', {
        p_query_id: body.queryId || null,
        p_scan_type: body.queryId ? 'query' : 'all_queries',
        p_lease_seconds: PAPPERS_RUN_LEASE_SECONDS,
      });
      if (error) {
        if (isPappersTransitionConflictCode(error.code)) {
          await throwTransitionConflict(supabase, action, null);
        }
        throw new PappersRunRequestError(
          'pappers_start_failed',
          `Impossible de créer le scan: ${error.message}`,
          500,
        );
      }
      if (data?.status === 'reconciliation_required') {
        return json({
          success: false,
          status: 'reconciliation_required',
          code: 'pappers_request_reconciliation_required',
          scanId: data.scan_id || null,
          error: 'Un appel Pappers envoyé sans réponse durable doit être réconcilié manuellement.',
        }, 409);
      }
      if (!data?.scan_id || !data?.lease_token) {
        const current = await observeActiveScan(supabase);
        if (current) await throwTransitionConflict(supabase, action, current.id);
        throw new PappersRunRequestError(
          'pappers_start_empty_result',
          'Impossible de créer le scan: réponse vide',
          500,
        );
      }
      scanId = data.scan_id;
      leaseToken = data.lease_token;
      engineQueryId = data.query_id || undefined;
    }

    const task = invokeEngine({ supabaseUrl, serviceKey, scanId: scanId!, leaseToken: leaseToken!, queryId: engineQueryId })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        // Une erreur HTTP de dispatch ne prouve pas que le worker n'a pas
        // démarré. Conserver le run en attente permet au recovery de reprendre
        // le même scan/cursor après expiration du bail, sans créer un doublon.
        console.error('[run-pappers-scan] dispatch moteur non confirmé; recovery attendu', message);
      });

    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task);
    else await task;

    const current = await observeScan(supabase, scanId!);
    if (!current || (current.status !== 'pending' && current.status !== 'running')) {
      throw new PappersTransitionConflictError(action, scanId!, observedStatus(current));
    }

    return json({
      success: true,
      status: current.status,
      scanId,
      message: action === 'resume'
        ? 'Scan Pappers repris.'
        : action === 'recover'
        ? 'Scan Pappers récupéré sur son dernier checkpoint.'
        : 'Scan Pappers lancé.',
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PappersTransitionConflictError) {
      return json({
        success: false,
        status: 'conflict',
        code: error.code,
        action: error.action,
        scanId: error.scanId,
        currentStatus: error.currentStatus,
        error: message,
      }, 409);
    }
    if (error instanceof PappersRunRequestError) {
      return json({ success: false, status: 'error', code: error.code, error: message }, error.httpStatus);
    }
    return json({ success: false, status: 'error', error: message }, 400);
  }
});

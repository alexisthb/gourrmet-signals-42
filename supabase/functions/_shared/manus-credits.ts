// Helper partagé de gestion des crédits Manus (audit Fable).
//
// AVANT : seuls fetch-company-logo et scan-linkedin-manus vérifiaient le solde avant de
// lancer une tâche, et SEUL fetch-company-logo comptabilisait sa consommation dans
// manus_credit_usage. Résultat : les plus gros consommateurs (contacts via
// trigger-manus-enrichment, engagers via enrich-linkedin-engager) POSTaient sans contrôle
// et n'écrivaient jamais rien -> la jauge du Dashboard sous-estimait massivement, les
// garde-fous ne se déclenchaient jamais, et l'épuisement se découvrait en cascade de
// 'failed_credit'. Ce module unifie check + log pour TOUTE tâche Manus payante.

export interface ManusCreditStatus {
  ok: boolean;       // true = on peut lancer une tâche
  used: number;
  limit: number;
  remaining: number;
  periodEnd: string;
}

export async function checkManusCredits(supabase: any): Promise<ManusCreditStatus> {
  const now = new Date();
  const { data: plan } = await supabase.from('manus_plan_settings').select('*').maybeSingle();
  const limit = plan?.monthly_credits || 1000;
  const periodStart = plan?.current_period_start
    || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const periodEnd = plan?.current_period_end
    || new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const { data: usage } = await supabase
    .from('manus_credit_usage')
    .select('credits_used')
    .gte('date', periodStart)
    .lte('date', periodEnd);
  const used = (usage || []).reduce((s: number, r: any) => s + Number(r.credits_used || 0), 0);
  const remaining = limit - used;
  return { ok: remaining > 0, used, limit, remaining, periodEnd };
}

// À appeler APRÈS chaque création réussie de tâche Manus. Non bloquant (best-effort).
export async function logManusUsage(
  supabase: any,
  opts: { signalId?: string | null; type: string; taskId?: string; companyName?: string; credits?: number },
): Promise<void> {
  try {
    await supabase.from('manus_credit_usage').insert({
      credits_used: opts.credits ?? 1,
      enrichments_count: 1,
      signal_id: opts.signalId ?? null,
      details: { type: opts.type, company_name: opts.companyName, task_id: opts.taskId },
    });
  } catch (e) {
    console.error('[manus-credits] logManusUsage failed:', e);
  }
}

export function manusCreditsExhaustedResponse(
  status: ManusCreditStatus,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify({
    skipped: true,
    reason: 'manus_credits_exhausted',
    error_code: 'MANUS_CREDIT_LIMIT',
    details: { used: status.used, limit: status.limit, remaining: 0, period_end: status.periodEnd },
    message: `Crédits Manus épuisés (${status.used}/${status.limit}). Réinitialisation le ${new Date(status.periodEnd).toLocaleDateString('fr-FR')}.`,
  }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

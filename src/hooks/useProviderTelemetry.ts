import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json, ProviderName } from '@/integrations/supabase/types';
import { collectAllPages } from '@/lib/supabasePagination';

export type DropcontactMeasurementStatus =
  | 'current'
  | 'stale'
  | 'unavailable'
  | 'not_started';

export interface DropcontactBalanceStatus {
  provider: 'dropcontact';
  creditsLeft: number | null;
  balanceObservedAt: string | null;
  latestCallAt: string | null;
  balanceAgeSeconds: number | null;
  measurementStatus: DropcontactMeasurementStatus;
}

export interface TokenTelemetry {
  periodStart: string;
  periodEnd: string;
  totalRequests: number;
  tokenCountedRequests: number;
  requestsWithoutTokenCount: number;
  exactTokens: number;
  latestEventAt: string | null;
}

export interface ProviderUsageTelemetryRow {
  id: string;
  occurred_at: string;
  requests_count: number;
  units: number;
  metadata: Json;
}

interface TokenCounterMarker {
  key: 'unit_name' | 'unit_basis';
  value: 'tokens' | 'total_tokens';
}

function asRecord(value: Json): Record<string, Json | undefined> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function exactNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nullableTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function currentMonthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { periodStart: start.toISOString(), periodEnd: now.toISOString() };
}

export function summarizeTokenTelemetry(
  rows: ProviderUsageTelemetryRow[],
  marker: TokenCounterMarker,
  bounds: { periodStart: string; periodEnd: string },
): TokenTelemetry {
  let totalRequests = 0;
  let tokenCountedRequests = 0;
  let exactTokens = 0;
  let latestEventAt: string | null = null;

  for (const row of rows) {
    const requests = exactNonNegativeInteger(row.requests_count) ?? 0;
    const tokens = exactNonNegativeInteger(row.units);
    const metadata = asRecord(row.metadata);
    const hasExactTokenCounter = metadata?.[marker.key] === marker.value && tokens !== null;

    totalRequests += requests;
    if (hasExactTokenCounter) {
      tokenCountedRequests += requests;
      exactTokens += tokens;
    }
    if (!latestEventAt || row.occurred_at > latestEventAt) latestEventAt = row.occurred_at;
  }

  return {
    ...bounds,
    totalRequests,
    tokenCountedRequests,
    requestsWithoutTokenCount: totalRequests - tokenCountedRequests,
    exactTokens,
    latestEventAt,
  };
}

async function loadMonthlyTokenTelemetry(
  provider: Extract<ProviderName, 'perplexity' | 'lovable_ai'>,
  marker: TokenCounterMarker,
): Promise<TokenTelemetry> {
  // La borne haute fige le jeu lu pendant la pagination : un nouvel appel ne
  // peut pas décaler les pages et faire compter deux fois une ligne.
  const bounds = currentMonthBounds();
  const rows = await collectAllPages<ProviderUsageTelemetryRow>(async (from, to) => {
    const { data, error } = await supabase
      .from('provider_usage_events')
      .select('id, occurred_at, requests_count, units, metadata')
      .eq('provider', provider)
      .gte('occurred_at', bounds.periodStart)
      .lte('occurred_at', bounds.periodEnd)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    return { data: data as ProviderUsageTelemetryRow[] | null, error };
  });

  return summarizeTokenTelemetry(rows, marker, bounds);
}

export function useDropcontactBalanceStatus() {
  return useQuery({
    queryKey: ['dropcontact-balance-status'],
    queryFn: async (): Promise<DropcontactBalanceStatus> => {
      const { data, error } = await supabase.rpc('dropcontact_balance_status');
      if (error) throw error;

      const payload = data !== null && typeof data === 'object' && !Array.isArray(data)
        ? data as Record<string, unknown>
        : {};
      const rawStatus = payload.measurement_status;
      const measurementStatus: DropcontactMeasurementStatus =
        rawStatus === 'current' || rawStatus === 'stale' || rawStatus === 'not_started'
          ? rawStatus
          : 'unavailable';

      return {
        provider: 'dropcontact',
        creditsLeft: nullableNonNegativeNumber(payload.credits_left),
        balanceObservedAt: nullableTimestamp(payload.balance_observed_at),
        latestCallAt: nullableTimestamp(payload.latest_call_at),
        balanceAgeSeconds: nullableNonNegativeNumber(payload.balance_age_seconds),
        measurementStatus,
      };
    },
    refetchInterval: 60_000,
  });
}

export function useLovableAITelemetry() {
  return useQuery({
    queryKey: ['provider-token-telemetry', 'lovable_ai', new Date().toISOString().slice(0, 7)],
    queryFn: () => loadMonthlyTokenTelemetry(
      'lovable_ai',
      { key: 'unit_basis', value: 'total_tokens' },
    ),
    refetchInterval: 60_000,
  });
}

export function loadPerplexityTelemetry() {
  return loadMonthlyTokenTelemetry(
    'perplexity',
    { key: 'unit_name', value: 'tokens' },
  );
}

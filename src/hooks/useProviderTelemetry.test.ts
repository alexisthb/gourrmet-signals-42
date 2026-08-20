import { describe, expect, it, vi } from 'vitest';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));

import {
  summarizeTokenTelemetry,
  type ProviderUsageTelemetryRow,
} from './useProviderTelemetry';

const bounds = {
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-08-31T23:59:59.999Z',
};

function row(
  id: string,
  requests: number,
  units: number,
  metadata: ProviderUsageTelemetryRow['metadata'],
): ProviderUsageTelemetryRow {
  return {
    id,
    occurred_at: `2026-08-20T10:00:0${id}.000Z`,
    requests_count: requests,
    units,
    metadata,
  };
}

describe('summarizeTokenTelemetry', () => {
  it('ne somme les tokens Perplexity que pour le compteur fournisseur exact', () => {
    const result = summarizeTokenTelemetry([
      row('1', 1, 240, { unit_name: 'tokens' }),
      row('2', 1, 99, { unit_name: 'tokens_pending' }),
      row('3', 2, 0, {}),
    ], { key: 'unit_name', value: 'tokens' }, bounds);

    expect(result).toMatchObject({
      totalRequests: 4,
      tokenCountedRequests: 1,
      requestsWithoutTokenCount: 3,
      exactTokens: 240,
    });
  });

  it('sépare les appels Lovable AI sans total_tokens sans reconstruire leur coût', () => {
    const result = summarizeTokenTelemetry([
      row('1', 1, 1_200, { unit_basis: 'total_tokens' }),
      row('2', 1, 0, { unit_basis: 'tokens_not_returned' }),
      row('3', 1, 800, { unit_name: 'tokens' }),
    ], { key: 'unit_basis', value: 'total_tokens' }, bounds);

    expect(result).toMatchObject({
      totalRequests: 3,
      tokenCountedRequests: 1,
      requestsWithoutTokenCount: 2,
      exactTokens: 1_200,
    });
  });
});

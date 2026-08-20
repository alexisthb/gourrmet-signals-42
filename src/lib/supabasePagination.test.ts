import { describe, expect, it } from 'vitest';
import { chunkValues, collectAllPages } from './supabasePagination';

describe('collectAllPages', () => {
  it('assemble toutes les pages sans s arrêter au plafond PostgREST', async () => {
    const source = Array.from({ length: 2_250 }, (_, id) => ({ id }));
    const rows = await collectAllPages(
      async (from, to) => ({ data: source.slice(from, to + 1), error: null }),
      { pageSize: 1_000, maxRows: 5_000 },
    );
    expect(rows).toHaveLength(2_250);
    expect(rows.at(-1)?.id).toBe(2_249);
  });

  it('échoue explicitement au lieu de tronquer quand maxRows est atteint', async () => {
    const source = Array.from({ length: 3_000 }, (_, id) => ({ id }));
    await expect(collectAllPages(
      async (from, to) => ({ data: source.slice(from, to + 1), error: null }),
      { pageSize: 1_000, maxRows: 2_000 },
    )).rejects.toThrow('limite explicite');
  });

  it('continue quand PostgREST impose une page plus petite que demandée', async () => {
    const source = Array.from({ length: 1_250 }, (_, id) => ({ id }));
    const rows = await collectAllPages(
      async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 500)), error: null }),
      { pageSize: 1_000, maxRows: 2_000 },
    );
    expect(rows).toHaveLength(1_250);
  });

  it('accepte un résultat exactement égal à maxRows après probe vide', async () => {
    const source = Array.from({ length: 2_000 }, (_, id) => ({ id }));
    const rows = await collectAllPages(
      async (from, to) => ({ data: source.slice(from, to + 1), error: null }),
      { pageSize: 1_000, maxRows: 2_000 },
    );
    expect(rows).toHaveLength(2_000);
  });
});

describe('chunkValues', () => {
  it('borne la taille des listes envoyées à .in()', () => {
    expect(chunkValues([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rejette une taille invalide', () => {
    expect(() => chunkValues([1], 0)).toThrow('chunkSize invalide');
  });
});

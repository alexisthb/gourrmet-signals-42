export interface PageResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

export function chunkValues<T>(values: readonly T[], chunkSize = 100): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error(`chunkSize invalide: ${chunkSize}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function collectAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? 1_000;
  const maxRows = options.maxRows ?? 100_000;
  if (pageSize < 1 || pageSize > 1_000) throw new Error(`pageSize invalide: ${pageSize}`);
  if (maxRows < pageSize) throw new Error(`maxRows doit être >= pageSize`);

  const rows: T[] = [];
  for (;;) {
    if (rows.length >= maxRows) {
      // Une page exactement pleine n'indique pas si l'on a atteint la fin ou
      // seulement notre garde-fou. Un probe d'une ligne tranche sans tronquer.
      const { data, error } = await fetchPage(rows.length, rows.length);
      if (error) throw new Error(error.message || 'Erreur PostgREST pendant la pagination');
      if ((data || []).length === 0) return rows;
      throw new Error(`Résultat supérieur à la limite explicite de ${maxRows} lignes`);
    }

    const from = rows.length;
    const requested = Math.min(pageSize, maxRows - rows.length);
    const { data, error } = await fetchPage(from, from + requested - 1);
    if (error) throw new Error(error.message || 'Erreur PostgREST pendant la pagination');
    const page = data || [];
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

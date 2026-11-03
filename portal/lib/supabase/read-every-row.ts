/** PostgREST stops a bare select at `max_rows` (supabase/config.toml). */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Reads every matching row. `readPage` must apply a stable order and an
 * inclusive range; a short page ends the walk. A range the server ignores
 * would otherwise repeat the first page forever, so the walk stops and throws.
 */
export async function readEveryRow<T>(
  readPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = POSTGREST_MAX_ROWS,
): Promise<T[]> {
  if (pageSize < 1) throw new Error("pageSize must be positive");
  const rows: T[] = [];
  const maxPages = 100;
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error("Row page did not end");
}

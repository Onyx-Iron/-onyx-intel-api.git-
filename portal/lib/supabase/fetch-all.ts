/**
 * PostgREST stops a response at `max_rows` (1000 in portal/supabase/config.toml)
 * and still returns 200. A query with no range therefore looks complete while
 * omitting every later row. Callers that insert from that partial list duplicate
 * lines; callers that total it understate the bid.
 *
 * Page size must not exceed the server max. A short page is the end. A full
 * page is fetched again. The sort must be unique or a later page can skip a row.
 */

export const POSTGREST_MAX_ROWS = 1000;
const MAX_PAGES = 200;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export async function fetchAllPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = POSTGREST_MAX_ROWS,
): Promise<{ rows: T[]; error: string | null }> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    return { rows: [], error: "pageSize must be a positive integer" };
  }
  const rows: T[] = [];
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, error: null };
    from += pageSize;
  }
  return { rows, error: `Query exceeded ${MAX_PAGES * pageSize} rows` };
}

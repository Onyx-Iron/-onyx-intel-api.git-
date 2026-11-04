/** In-memory PostgREST chain for unit tests. Filters run in memory. */

export type MemoryRow = Record<string, unknown>;

export interface MemoryQueryResult {
  data: MemoryRow | MemoryRow[] | null;
  error: { message: string } | null;
  count: number | null;
}

export interface MemoryQueryFailure {
  table: string;
  op: "select" | "insert" | "update";
}

interface QueryState {
  filters: Array<(row: MemoryRow) => boolean>;
  orderKey: string | null;
  orderAsc: boolean;
  limitN: number | null;
  mode: "many" | "maybeSingle" | "single";
  op: "select" | "insert" | "update";
  patch: MemoryRow | null;
  insertRows: MemoryRow[] | null;
  countExact: boolean;
  head: boolean;
}

export interface MemoryQuery {
  select(columns?: string, options?: { count?: string; head?: boolean }): MemoryQuery;
  insert(payload: MemoryRow | MemoryRow[]): MemoryQuery;
  update(patch: MemoryRow): MemoryQuery;
  eq(column: string, value: unknown): MemoryQuery;
  in(column: string, values: readonly unknown[]): MemoryQuery;
  is(column: string, value: unknown): MemoryQuery;
  gte(column: string, value: string): MemoryQuery;
  not(column: string, operator: string, value: unknown): MemoryQuery;
  or(expression: string): MemoryQuery;
  order(column: string, options?: { ascending?: boolean }): MemoryQuery;
  limit(count: number): MemoryQuery;
  maybeSingle(): MemoryQuery;
  single(): MemoryQuery;
  then<TResult1 = MemoryQueryResult, TResult2 = never>(
    onfulfilled?: ((value: MemoryQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export function createMemoryDb(
  tables: Record<string, MemoryRow[]>,
  options: { fail?: MemoryQueryFailure[] } = {},
) {
  let nextId = 1;
  const store: Record<string, MemoryRow[]> = {};
  for (const [name, rows] of Object.entries(tables)) {
    store[name] = rows.map((row) => ({ ...row }));
  }

  function from(table: string): MemoryQuery {
    const state: QueryState = {
      filters: [],
      orderKey: null,
      orderAsc: true,
      limitN: null,
      mode: "many",
      op: "select",
      patch: null,
      insertRows: null,
      countExact: false,
      head: false,
    };

    const api: MemoryQuery = {
      select(_columns?, selectOptions?) {
        if (selectOptions?.count === "exact") state.countExact = true;
        if (selectOptions?.head) state.head = true;
        return api;
      },
      insert(payload) {
        state.op = "insert";
        const rows = Array.isArray(payload) ? payload : [payload];
        state.insertRows = rows.map((row) => ({
          ...row,
          id: typeof row.id === "string" ? row.id : `mem-${nextId++}`,
        }));
        return api;
      },
      update(patch) {
        state.op = "update";
        state.patch = patch;
        return api;
      },
      eq(column, value) {
        state.filters.push((row) => row[column] === value);
        return api;
      },
      in(column, values) {
        const allowed = new Set(values);
        state.filters.push((row) => allowed.has(row[column]));
        return api;
      },
      is(column, value) {
        state.filters.push((row) => (row[column] ?? null) === value);
        return api;
      },
      gte(column, value) {
        state.filters.push((row) => String(row[column] ?? "") >= value);
        return api;
      },
      not(column, operator, value) {
        if (operator === "is" && value == null) {
          state.filters.push((row) => row[column] != null);
        }
        return api;
      },
      or(expression) {
        state.filters.push((row) => matchesOr(row, expression));
        return api;
      },
      order(column, orderOptions) {
        state.orderKey = column;
        state.orderAsc = orderOptions?.ascending !== false;
        return api;
      },
      limit(count) {
        state.limitN = count;
        return api;
      },
      maybeSingle() {
        state.mode = "maybeSingle";
        return api;
      },
      single() {
        state.mode = "single";
        return api;
      },
      then<TResult1 = MemoryQueryResult, TResult2 = never>(
        onfulfilled?: ((value: MemoryQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return new Promise<TResult1 | TResult2>((resolve, reject) => {
          try {
            const result = execute(table, state, store, options.fail ?? []);
            if (onfulfilled) resolve(onfulfilled(result));
            else resolve(result as TResult1);
          } catch (error) {
            if (onrejected) resolve(onrejected(error));
            else reject(error);
          }
        });
      },
    };
    return api;
  }

  return { from, rows: store };
}

function execute(
  table: string,
  state: QueryState,
  store: Record<string, MemoryRow[]>,
  fail: MemoryQueryFailure[],
): MemoryQueryResult {
  if (fail.some((item) => item.table === table && item.op === state.op)) {
    return { data: null, error: { message: `${state.op} ${table} failed` }, count: null };
  }

  if (state.op === "insert" && state.insertRows) {
    const target = store[table] ?? [];
    store[table] = target;
    target.push(...state.insertRows);
    return { data: state.insertRows, error: null, count: state.insertRows.length };
  }

  let matched = (store[table] ?? []).filter((row) => state.filters.every((filter) => filter(row)));
  if (state.orderKey) {
    const key = state.orderKey;
    const direction = state.orderAsc ? 1 : -1;
    matched = [...matched].sort(
      (left, right) => String(left[key] ?? "").localeCompare(String(right[key] ?? "")) * direction,
    );
  }
  if (state.limitN != null) matched = matched.slice(0, state.limitN);

  if (state.op === "update" && state.patch) {
    for (const row of matched) Object.assign(row, state.patch);
  }

  if (state.mode === "single") {
    if (matched.length !== 1) {
      return { data: null, error: { message: `expected one ${table} row` }, count: null };
    }
    return { data: matched[0], error: null, count: state.countExact ? 1 : null };
  }
  if (state.mode === "maybeSingle") {
    return { data: matched[0] ?? null, error: null, count: state.countExact ? matched.length : null };
  }
  return {
    data: state.head ? null : matched,
    error: null,
    count: state.countExact ? matched.length : null,
  };
}

function matchesOr(row: MemoryRow, expression: string): boolean {
  return splitTopLevel(expression).some((part) => matchesFilter(row, part));
}

function splitTopLevel(expression: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of expression) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function matchesFilter(row: MemoryRow, part: string): boolean {
  const text = part.trim();
  const inn = text.match(/^([A-Za-z0-9_]+)\.in\.\((.*)\)$/);
  if (inn) {
    const values = inn[2].split(",").map((value) => value.trim());
    return values.includes(String(row[inn[1]] ?? ""));
  }
  const isNull = text.match(/^([A-Za-z0-9_]+)\.is\.null$/);
  if (isNull) return row[isNull[1]] == null;
  const eq = text.match(/^([A-Za-z0-9_]+)\.eq\.(.*)$/);
  if (eq) return String(row[eq[1]] ?? "") === eq[2];
  return false;
}

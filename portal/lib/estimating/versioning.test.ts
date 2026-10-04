import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getOrCreateDraftVersion } from "./versioning.ts";

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for the three tables this helper touches.
 * `.range` honors the same inclusive page the PostgREST client uses, so a
 * copy that forgets to page stops at 1000 lines.
 */
function memoryDb(options?: { stealClaim?: boolean }) {
  const tables: Record<string, Row[]> = {
    estimates: [{
      id: "est-1",
      tenant_id: "tenant-1",
      project_id: "project-1",
      current_version_id: "v-approved",
      created_at: "2026-01-01T00:00:00.000Z",
    }],
    estimate_versions: [
      {
        id: "v-approved",
        estimate_id: "est-1",
        version_number: 1,
        status: "approved",
        contingency_pct: 5,
        overhead_pct: 10,
        profit_pct: 15,
      },
      {
        id: "v-winner",
        estimate_id: "est-1",
        version_number: 9,
        status: "draft",
        contingency_pct: 5,
        overhead_pct: 10,
        profit_pct: 15,
      },
    ],
    estimate_items: Array.from({ length: 1001 }, (_, index) => ({
      id: `item-${String(index).padStart(4, "0")}`,
      estimate_version_id: "v-approved",
      description: `line ${index}`,
      quantity: index + 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    })),
  };
  let seq = 0;
  let claimStolen = false;

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private sortKey: string | null = null;
    private sortAsc = true;
    private max: number | null = null;
    private rangeFrom: number | null = null;
    private rangeTo: number | null = null;
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row | Row[] | null = null;
    private patch: Row | null = null;

    constructor(private table: string) {}

    select(): this { return this; }

    eq(column: string, value: unknown): this {
      this.filters.push((row) => row[column] === value);
      return this;
    }

    order(column: string, opts?: { ascending?: boolean }): this {
      this.sortKey = column;
      this.sortAsc = opts?.ascending !== false;
      return this;
    }

    limit(count: number): this {
      this.max = count;
      return this;
    }

    range(from: number, to: number): this {
      this.rangeFrom = from;
      this.rangeTo = to;
      return this;
    }

    insert(payload: Row | Row[]): this {
      this.op = "insert";
      this.payload = payload;
      return this;
    }

    update(patch: Row): this {
      this.op = "update";
      this.patch = patch;
      return this;
    }

    delete(): this {
      this.op = "delete";
      return this;
    }

    private matching(): Row[] {
      let rows = tables[this.table].filter((row) => this.filters.every((filter) => filter(row)));
      if (this.sortKey) {
        const key = this.sortKey;
        const asc = this.sortAsc;
        rows = [...rows].sort((a, b) => {
          const av = a[key];
          const bv = b[key];
          if (typeof av === "number" && typeof bv === "number") return asc ? av - bv : bv - av;
          return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
        });
      }
      if (this.rangeFrom != null && this.rangeTo != null) {
        rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
      }
      if (this.max != null) rows = rows.slice(0, this.max);
      return rows;
    }

    private execute(): { data: Row[] | null; error: { message: string } | null } {
      if (this.op === "update" && this.table === "estimates" && options?.stealClaim && !claimStolen) {
        claimStolen = true;
        const estimate = tables.estimates[0];
        if (estimate) estimate.current_version_id = "v-winner";
      }
      if (this.op === "insert") {
        const incoming = Array.isArray(this.payload) ? this.payload : this.payload ? [this.payload] : [];
        const stored = incoming.map((row) => {
          const copy = { ...row };
          if (!copy.id) {
            seq += 1;
            copy.id = `${this.table}-${seq}`;
          }
          tables[this.table].push(copy);
          return copy;
        });
        return { data: stored, error: null };
      }
      if (this.op === "update") {
        const matched = this.matching();
        for (const row of matched) Object.assign(row, this.patch);
        return { data: matched, error: null };
      }
      if (this.op === "delete") {
        const matched = new Set(this.matching());
        tables[this.table] = tables[this.table].filter((row) => !matched.has(row));
        return { data: [...matched], error: null };
      }
      return { data: this.matching(), error: null };
    }

    then<TResult1 = { data: Row[] | null; error: { message: string } | null }, TResult2 = never>(
      onFulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
      onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      try {
        const value = this.execute();
        return Promise.resolve(onFulfilled ? onFulfilled(value) : value as TResult1);
      } catch (error) {
        if (onRejected) return Promise.resolve(onRejected(error));
        return Promise.reject(error);
      }
    }

    maybeSingle(): Promise<{ data: Row | null; error: { message: string } | null }> {
      const result = this.execute();
      const rows = result.data ?? [];
      if (rows.length > 1) return Promise.resolve({ data: null, error: { message: "multiple rows" } });
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }

    single(): Promise<{ data: Row | null; error: { message: string } | null }> {
      const result = this.execute();
      const rows = result.data ?? [];
      if (rows.length !== 1) return Promise.resolve({ data: null, error: { message: `expected 1 row, got ${rows.length}` } });
      return Promise.resolve({ data: rows[0], error: null });
    }
  }

  return {
    tables,
    from(table: string) {
      return new Query(table);
    },
  };
}

describe("getOrCreateDraftVersion", () => {
  it("keeps later syncs on one draft and copies every locked line", async () => {
    const db = memoryDb();
    const first = await getOrCreateDraftVersion(db, "tenant-1", "project-1", "estimator");
    const second = await getOrCreateDraftVersion(db, "tenant-1", "project-1", "estimator");

    assert.equal(second.versionId, first.versionId);
    assert.equal(db.tables.estimates[0].current_version_id, first.versionId);
    assert.equal(
      db.tables.estimate_versions.filter((row) => row.status === "draft" && row.id !== "v-winner").length,
      1,
    );
    const copied = db.tables.estimate_items.filter((row) => row.estimate_version_id === first.versionId);
    assert.equal(copied.length, 1001);
    assert.equal(db.tables.estimate_versions.find((row) => row.id === "v-approved")?.status, "approved");
  });

  it("drops the extra draft when another sync already published one", async () => {
    const db = memoryDb({ stealClaim: true });
    const result = await getOrCreateDraftVersion(db, "tenant-1", "project-1", "estimator");

    assert.equal(result.versionId, "v-winner");
    assert.equal(db.tables.estimates[0].current_version_id, "v-winner");
    assert.equal(db.tables.estimate_versions.some((row) => row.id !== "v-approved" && row.id !== "v-winner"), false);
    assert.equal(db.tables.estimate_items.some((row) => row.estimate_version_id !== "v-approved"), false);
  });
});

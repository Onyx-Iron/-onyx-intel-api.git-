import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issueAwardedPurchaseOrder, type AwardBidCommand } from "./award-bid.ts";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly rows: Row[],
    private readonly op: "update" | "insert" | "delete",
    private readonly payload: Row,
    private readonly uniqueKey?: string,
  ) {}

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  select(): this {
    return this;
  }

  single(): Promise<{ data: Row | null; error: { message: string; code?: string } | null }> {
    return this.execute().then((result) => ({
      data: result.data[0] ?? null,
      error: result.error,
    }));
  }

  then<T>(
    resolve: (value: { data: Row[]; error: { message: string; code?: string } | null }) => T,
    reject?: (reason: unknown) => T,
  ): Promise<T> {
    return this.execute().then(resolve, reject);
  }

  private async execute(): Promise<{ data: Row[]; error: { message: string; code?: string } | null }> {
    const matched = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.op === "update") {
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched.map((row) => ({ ...row })), error: null };
    }
    if (this.op === "delete") {
      const removed: Row[] = [];
      for (let i = this.rows.length - 1; i >= 0; i--) {
        if (this.filters.every((filter) => filter(this.rows[i]))) removed.push(this.rows.splice(i, 1)[0]);
      }
      return { data: removed, error: null };
    }
    if (this.uniqueKey && this.rows.some((row) => row[this.uniqueKey!] === this.payload[this.uniqueKey!])) {
      return { data: [], error: { message: "duplicate key value violates unique constraint", code: "23505" } };
    }
    const created = { id: `po-${this.rows.length + 1}`, ...this.payload };
    this.rows.push(created);
    return { data: [{ ...created }], error: null };
  }
}

function createDb(requestStatus = "open") {
  const tables: Record<string, Row[]> = {
    marketplace_requests: [{ id: "req-1", tenant_id: "tenant-1", status: requestStatus, project_id: "proj-1" }],
    vendor_bids: [
      { id: "bid-a", tenant_id: "tenant-1", request_id: "req-1", status: "pending" },
      { id: "bid-b", tenant_id: "tenant-1", request_id: "req-1", status: "pending" },
    ],
    purchase_orders: [],
  };
  return {
    tables,
    from(name: string) {
      const uniqueKey = name === "purchase_orders" ? "vendor_bid_id" : undefined;
      return {
        update: (payload: Row) => new Query(tables[name], "update", payload),
        insert: (payload: Row) => new Query(tables[name], "insert", payload, uniqueKey),
        delete: () => new Query(tables[name], "delete", {}),
      };
    },
  };
}

function command(bidId: string): AwardBidCommand {
  return {
    tenantId: "tenant-1",
    userId: "user-1",
    terms: null,
    bid: { id: bidId, request_id: "req-1", unit_price: 2 },
    request: { id: "req-1", project_id: "proj-1", quantity: 10, status: "open" },
  };
}

describe("issueAwardedPurchaseOrder", () => {
  it("issues one purchase order and declines the other bid", async () => {
    const db = createDb();
    const result = await issueAwardedPurchaseOrder(db, command("bid-a"), () => false);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.totalAmount, 20);
    assert.equal(db.tables.purchase_orders.length, 1);
    assert.equal(db.tables.vendor_bids.find((bid) => bid.id === "bid-a")?.status, "awarded");
    assert.equal(db.tables.vendor_bids.find((bid) => bid.id === "bid-b")?.status, "declined");
    assert.equal(db.tables.marketplace_requests[0].status, "awarded");
  });

  it("does not leave a second purchase order when two bids are approved together", async () => {
    const db = createDb();
    const [first, second] = await Promise.all([
      issueAwardedPurchaseOrder(db, command("bid-a"), () => false),
      issueAwardedPurchaseOrder(db, command("bid-b"), () => false),
    ]);
    const winners = [first, second].filter((result) => result.ok);
    const losers = [first, second].filter((result) => !result.ok);
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].ok, false);
    if (losers[0].ok) return;
    assert.equal(losers[0].status, 409);
    assert.equal(db.tables.purchase_orders.length, 1);
    const awarded = db.tables.vendor_bids.filter((bid) => bid.status === "awarded");
    assert.equal(awarded.length, 1);
    assert.equal(awarded[0].id, db.tables.purchase_orders[0].vendor_bid_id);
  });

  it("reopens the request when the purchase order insert fails", async () => {
    const db = createDb();
    db.tables.purchase_orders.push({ id: "po-existing", tenant_id: "tenant-1", vendor_bid_id: "bid-a", status: "issued" });
    const result = await issueAwardedPurchaseOrder(
      db,
      command("bid-a"),
      (error) => error?.code === "23505",
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(db.tables.marketplace_requests[0].status, "open");
    assert.equal(db.tables.purchase_orders.length, 1);
    assert.equal(db.tables.vendor_bids.find((bid) => bid.id === "bid-a")?.status, "pending");
  });
});

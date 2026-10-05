import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditStatusForDecision,
  claimPendingReview,
  releaseAuditClaim,
} from "./claimAudit.ts";

interface AuditRow {
  id: string;
  tenant_id: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  applied_result: Record<string, unknown> | null;
}

function memoryDb(row: AuditRow) {
  return {
    row,
    from(table: string) {
      if (table !== "ai_agent_audit_trails") throw new Error(`unexpected table ${table}`);
      return {
        update(values: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return chain;
            },
            select() {
              const matches = row.id === filters.id
                && row.tenant_id === filters.tenant_id
                && row.status === filters.status;
              if (!matches) return Promise.resolve({ data: [], error: null });
              Object.assign(row, values);
              return Promise.resolve({ data: [{ id: row.id }], error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

function pendingRow(): AuditRow {
  return {
    id: "audit-1",
    tenant_id: "tenant-1",
    status: "pending_human_review",
    reviewed_by: null,
    reviewed_at: null,
    applied_result: null,
  };
}

describe("agent review claim", () => {
  it("maps each decision onto one status", () => {
    assert.equal(auditStatusForDecision("approve"), "approved");
    assert.equal(auditStatusForDecision("reject"), "rejected");
    assert.equal(auditStatusForDecision("modify"), "approved_with_modifications");
  });

  it("lets the first approver claim and rejects the second", async () => {
    const db = memoryDb(pendingRow());
    const first = await claimPendingReview(db, {
      id: "audit-1",
      tenantId: "tenant-1",
      userId: "user-a",
      status: "approved",
    });
    const second = await claimPendingReview(db, {
      id: "audit-1",
      tenantId: "tenant-1",
      userId: "user-b",
      status: "approved",
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.conflict, true);
    assert.equal(db.row.status, "approved");
    assert.equal(db.row.reviewed_by, "user-a");
  });

  it("writes the estimate once when two approvers race", async () => {
    const db = memoryDb(pendingRow());
    const writes: string[] = [];
    async function approve(userId: string) {
      const claim = await claimPendingReview(db, {
        id: "audit-1",
        tenantId: "tenant-1",
        userId,
        status: "approved",
      });
      if (!claim.ok) return;
      writes.push(userId);
    }
    await Promise.all([approve("user-a"), approve("user-b")]);
    assert.deepEqual(writes, ["user-a"]);
    assert.equal(db.row.reviewed_by, "user-a");
  });

  it("returns a failed write to the queue so it can be approved once", async () => {
    const db = memoryDb(pendingRow());
    const claim = await claimPendingReview(db, {
      id: "audit-1",
      tenantId: "tenant-1",
      userId: "user-a",
      status: "approved",
    });
    assert.equal(claim.ok, true);
    await releaseAuditClaim(db, { id: "audit-1", tenantId: "tenant-1", status: "approved" });
    assert.equal(db.row.status, "pending_human_review");
    assert.equal(db.row.reviewed_by, null);
    const retry = await claimPendingReview(db, {
      id: "audit-1",
      tenantId: "tenant-1",
      userId: "user-a",
      status: "approved",
    });
    assert.equal(retry.ok, true);
    assert.equal(db.row.status, "approved");
  });
});

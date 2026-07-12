// Append-only audit trail for the estimating-core-consolidation workflow —
// mirrors lib/takeoff/history.ts's pattern (before/after JSON snapshots,
// batched inserts). Distinct from the generic project_events feed
// (lib/activity.ts): this is specifically for financial before/after values
// (STEP 13: "Include before and after values for financial changes").
export type EstimateAuditEntityType = "estimate" | "version" | "item" | "proposal" | "sov";
export type EstimateAuditAction =
  | "created" | "updated" | "deleted" | "imported"
  | "approved" | "superseded" | "generated" | "buyer_adjustment";

export interface EstimateAuditEntry {
  tenantId: string;
  projectId?: string | null;
  estimateId?: string | null;
  estimateVersionId?: string | null;
  entityType: EstimateAuditEntityType;
  entityId?: string | null;
  action: EstimateAuditAction;
  actorUserId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordEstimateAudit(db: any, entry: EstimateAuditEntry): Promise<void> {
  await recordEstimateAuditBatch(db, [entry]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordEstimateAuditBatch(db: any, entries: EstimateAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const { error } = await db.from("estimate_audit_log").insert(entries.map((entry) => ({
    tenant_id: entry.tenantId,
    project_id: entry.projectId ?? null,
    estimate_id: entry.estimateId ?? null,
    estimate_version_id: entry.estimateVersionId ?? null,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    actor_user_id: entry.actorUserId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  })));
  if (error) console.error("[recordEstimateAuditBatch]", error);
}

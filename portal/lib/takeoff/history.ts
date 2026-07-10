// Append-only audit trail for takeoff_items lifecycle events. Separate from
// the generic activity feed (lib/activity.ts, which is a coarse "N items
// saved" UI feed) — this is a per-row before/after record specifically for
// proving edits and deletions preserve audit history.
export type TakeoffHistoryAction = "created" | "updated" | "deleted" | "approved" | "rejected";

export interface TakeoffHistoryEntry {
  tenantId: string;
  projectId: string | null;
  takeoffItemId: string | null;
  action: TakeoffHistoryAction;
  actorUserId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recordTakeoffHistory(db: any, entry: TakeoffHistoryEntry): Promise<void> {
  const { error } = await db.from("takeoff_item_history").insert({
    tenant_id: entry.tenantId,
    project_id: entry.projectId,
    takeoff_item_id: entry.takeoffItemId,
    action: entry.action,
    actor_user_id: entry.actorUserId,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) console.error("[recordTakeoffHistory]", error);
}

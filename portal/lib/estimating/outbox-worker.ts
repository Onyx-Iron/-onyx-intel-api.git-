// Estimate-sync outbox worker (manual-takeoff-productivity milestone,
// STEP 14). Processes `estimate_sync_outbox` rows written atomically by
// save_manual_takeoff_tx / update_manual_takeoff_tx / soft_delete_manual_takeoff_tx
// (see the manual-takeoff-calibration-hardening milestone's TRANSACTION_DESIGN.md
// for why estimate-sync itself can't be folded into those DB transactions —
// it depends on lib/cost/resolver.ts's cost-resolution logic, which isn't
// portable to plpgsql).
//
// Claim mechanics (claim_outbox_events / complete_outbox_event /
// fail_outbox_event / retry_outbox_event) live in Postgres
// (20260810_productivity_row_version_and_outbox_worker.sql) — this module
// is the TypeScript-side processing logic those claimed rows actually run:
// 'upsert' -> syncTakeoffToEstimate (already idempotent); 'delete' ->
// reconcile any already-synced estimate_items row that belongs to a
// still-mutable DRAFT version (an approved/superseded version is never
// touched — immutability holds regardless of what happens to its source).
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import { collectDeletedMirrorIds, filterDraftEstimateItemIds, sourceRemovedEstimateFields } from "@/lib/estimating/delete-reconcile";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface OutboxProcessResult {
  claimed: number;
  completed: number;
  failed: number;
  deadLettered: number;
  errors: Array<{ id: string; error: string }>;
}

const MAX_ATTEMPTS = 5;

export interface ProcessOutboxBatchOptions {
  batchSize?: number;
  /**
   * Overrides the 'upsert' event handler. Defaults to the real
   * syncTakeoffToEstimate. `syncTakeoffToEstimate` calls
   * createServiceClient() internally, which depends on next/headers'
   * cookies() and can only run inside a real Next.js request — this hook
   * exists so integration tests (running under plain `node --test`, with no
   * request context) can substitute a reproduction of the same logic bound
   * to their own bare supabase-js client, exactly like this codebase's
   * other integration tests do for the same constraint (see
   * takeoff-integrity.integration.test.ts's `runRealSync`). Production
   * code should never pass this — the default is the real implementation.
   */
  syncFn?: (tenantId: string, projectId: string) => Promise<unknown>;
}

/**
 * Claims up to `batchSize` outbox events and processes each one. Safe to
 * call concurrently from multiple invocations (claim_outbox_events uses
 * `FOR UPDATE SKIP LOCKED`, so two overlapping calls never claim the same
 * row) and safe to call repeatedly (each event's business logic is itself
 * idempotent).
 */
export async function processOutboxBatch(
  db: AnyDb,
  workerId: string,
  options: number | ProcessOutboxBatchOptions = {},
): Promise<OutboxProcessResult> {
  // Accept a bare number for backward compatibility with the batchSize-only
  // call sites already wired into the API routes.
  const opts: ProcessOutboxBatchOptions = typeof options === "number" ? { batchSize: options } : options;
  const batchSize = opts.batchSize ?? 20;
  const syncFn = opts.syncFn ?? syncTakeoffToEstimate;

  const result: OutboxProcessResult = { claimed: 0, completed: 0, failed: 0, deadLettered: 0, errors: [] };

  const { data: claimed, error: claimErr } = await db.rpc("claim_outbox_events", {
    p_limit: batchSize, p_worker_id: workerId, p_visibility_timeout_seconds: 120,
  });
  if (claimErr) throw claimErr;

  const events = (claimed ?? []) as Array<{
    id: string; tenant_id: string; project_id: string; manual_takeoff_id: string | null;
    event_type: "upsert" | "delete" | "project_sync"; attempts: number;
    payload?: { mirror_id?: string | null; mirror_retained?: boolean } | null;
  }>;
  result.claimed = events.length;

  // syncTakeoffToEstimate reloads the whole project — running it once per
  // claimed upsert/project_sync is O(N) identical full syncs when a canvas
  // save or page-takeoff fan-out enqueues many rows for the same project.
  // Dedupe sync events by project first.
  type OutboxEvent = (typeof events)[number];
  const upsertGroups = new Map<string, OutboxEvent[]>();
  const deleteEvents: OutboxEvent[] = [];
  for (const event of events) {
    if (event.event_type === "upsert" || event.event_type === "project_sync") {
      const key = `${event.tenant_id}:${event.project_id}`;
      const group = upsertGroups.get(key);
      if (group) group.push(event);
      else upsertGroups.set(key, [event]);
    } else {
      deleteEvents.push(event);
    }
  }

  async function markComplete(event: OutboxEvent): Promise<void> {
    const { error } = await db.rpc("complete_outbox_event", { p_id: event.id });
    if (error) throw error;
    result.completed++;
  }

  async function markFailed(event: OutboxEvent, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const { error } = await db.rpc("fail_outbox_event", { p_id: event.id, p_error: message, p_max_attempts: MAX_ATTEMPTS });
    if (error) console.error("[outbox-worker] fail_outbox_event itself failed", error);
    if (event.attempts + 1 >= MAX_ATTEMPTS) result.deadLettered++;
    else result.failed++;
    result.errors.push({ id: event.id, error: message });
  }

  for (const group of upsertGroups.values()) {
    const head = group[0];
    try {
      await syncFn(head.tenant_id, head.project_id);
      for (const event of group) {
        try {
          await markComplete(event);
        } catch (err) {
          await markFailed(event, err);
        }
      }
    } catch (err) {
      for (const event of group) await markFailed(event, err);
    }
  }

  for (const event of deleteEvents) {
    try {
      if (!event.manual_takeoff_id) {
        throw new Error("delete outbox event missing manual_takeoff_id");
      }
      await reconcileDeletedTakeoffEstimateItems(
        db,
        event.tenant_id,
        event.project_id,
        event.manual_takeoff_id,
        event.payload?.mirror_id ?? null,
      );
      await markComplete(event);
    } catch (err) {
      await markFailed(event, err);
    }
  }

  return result;
}

/**
 * A manual takeoff's source measurement is gone (soft-deleted) — any
 * estimate_items row synced from it while it still existed is reconciled:
 * a still-DRAFT line is flagged source-removed and zeroed so it cannot stay
 * a live priced quantity. Approved and superseded versions stay untouched.
 */
async function reconcileDeletedTakeoffEstimateItems(
  db: AnyDb,
  tenantId: string,
  projectId: string,
  manualTakeoffId: string,
  payloadMirrorId: string | null = null,
): Promise<void> {
  // Prefer outbox payload.mirror_id (covers hard-deleted AND retained mirrors).
  // Fall back to history 'deleted' snapshots and any still-living mirror row
  // keyed by source_manual_takeoff_id (retained-for-locked-estimate case).
  const { data: historyRows } = await db
    .from("takeoff_item_history")
    .select("takeoff_item_id")
    .eq("tenant_id", tenantId)
    .eq("action", "deleted")
    .contains("before", { source_manual_takeoff_id: manualTakeoffId });
  const { data: retainedMirrors } = await db
    .from("takeoff_items")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_manual_takeoff_id", manualTakeoffId);

  const deletedMirrorIds = collectDeletedMirrorIds({
    payloadMirrorId,
    historyTakeoffItemIds: (historyRows ?? []).map((h: { takeoff_item_id: string }) => h.takeoff_item_id),
    retainedMirrorIds: (retainedMirrors ?? []).map((r: { id: string }) => r.id),
  });
  if (deletedMirrorIds.length === 0) return;

  const { data: linkedItems } = await db
    .from("estimate_items")
    .select("id, estimate_version_id, source_takeoff_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("source_takeoff_id", deletedMirrorIds);
  if (!linkedItems || linkedItems.length === 0) return;

  const versionIds = [...new Set(linkedItems.map((i: { estimate_version_id: string }) => i.estimate_version_id))];
  const { data: versions } = await db.from("estimate_versions").select("id, status").in("id", versionIds);
  const toFlagIds = filterDraftEstimateItemIds(linkedItems, versions ?? []);
  if (toFlagIds.length === 0) return;

  // Keep the draft/review line visible so estimators see the source was
  // removed (silent delete is worse UX). Zero costs so it cannot stay a
  // live priced quantity. Approved/superseded versions are never touched.
  const { data: existing } = await db
    .from("estimate_items")
    .select("id, notes")
    .in("id", toFlagIds);
  for (const row of (existing ?? []) as Array<{ id: string; notes: string | null }>) {
    await db.from("estimate_items").update(sourceRemovedEstimateFields(row.notes)).eq("id", row.id);
  }
}

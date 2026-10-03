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
//
// If that estimate write fails, or the event cannot be marked complete,
// this attempt's estimate inserts are removed and its deletes are put back,
// then the event is failed so it can retry. The canvas save that queued
// the event is already committed and is left alone. A claim error is
// returned on the result so the canvas HTTP response still succeeds.
import { syncTakeoffToEstimate } from "@/lib/estimating/auto-sync";
import {
  emptyOutboxUndo,
  insertedIdsFromSync,
  rollbackOutboxWrites,
  syncWriteFailure,
  type OutboxWriteUndo,
} from "@/lib/estimating/outbox-rollback";

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
  if (claimErr) {
    result.failed = 1;
    result.errors.push({ id: "claim", error: claimErr.message ?? "claim_outbox_events failed" });
    return result;
  }

  const events = (claimed ?? []) as Array<{
    id: string; tenant_id: string; project_id: string; manual_takeoff_id: string;
    event_type: "upsert" | "delete"; attempts: number;
  }>;
  result.claimed = events.length;

  for (const event of events) {
    const undo = emptyOutboxUndo();
    try {
      if (event.event_type === "upsert") {
        const synced = await syncFn(event.tenant_id, event.project_id);
        const failure = syncWriteFailure(synced);
        if (failure) {
          undo.insertedIds = failure.insertedIds;
          throw new Error(failure.writeError);
        }
        undo.insertedIds = insertedIdsFromSync(synced);
      } else {
        undo.restoredRows = await reconcileDeletedTakeoffEstimateItems(db, event.tenant_id, event.project_id, event.manual_takeoff_id);
      }
      const { error } = await db.rpc("complete_outbox_event", { p_id: event.id });
      if (error) throw new Error(error.message ?? "complete_outbox_event failed");
      result.completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await undoOutboxAttempt(db, undo);
      await releaseFailedEvent(db, event.id, message);
      if (event.attempts + 1 >= MAX_ATTEMPTS) result.deadLettered++;
      else result.failed++;
      result.errors.push({ id: event.id, error: message });
    }
  }

  return result;
}

/** Drop this attempt's estimate writes, then record the queue failure for retry. */
async function undoOutboxAttempt(db: AnyDb, undo: OutboxWriteUndo): Promise<void> {
  try {
    await rollbackOutboxWrites(db, undo);
  } catch (rollbackErr) {
    console.error("[outbox-worker] rollback failed", rollbackErr);
  }
}

async function releaseFailedEvent(db: AnyDb, eventId: string, message: string): Promise<void> {
  const { error } = await db.rpc("fail_outbox_event", { p_id: eventId, p_error: message, p_max_attempts: MAX_ATTEMPTS });
  if (!error) return;
  console.error("[outbox-worker] fail_outbox_event itself failed", error);
  const retryAt = new Date(Date.now() + 30_000).toISOString();
  const { error: fallback } = await db
    .from("estimate_sync_outbox")
    .update({
      status: "pending",
      last_error: message.slice(0, 2000),
      claimed_at: null,
      claimed_by: null,
      next_attempt_at: retryAt,
    })
    .eq("id", eventId);
  if (fallback) console.error("[outbox-worker] could not release the failed claim", fallback);
}

/**
 * A manual takeoff's source measurement is gone (soft-deleted) — any
 * estimate_items row synced from it while it still existed is reconciled:
 * removed from a still-DRAFT version (the line item no longer has a source
 * to justify its presence in an editable estimate), left completely
 * untouched if it belongs to an approved/superseded version (immutability
 * — STEP 9/RULE 9: approved estimate versions must never be silently
 * mutated by takeoff edits, including deletions).
 */
async function reconcileDeletedTakeoffEstimateItems(
  db: AnyDb,
  tenantId: string,
  projectId: string,
  manualTakeoffId: string,
): Promise<Record<string, unknown>[]> {
  // The mirror row itself is already hard-deleted by soft_delete_manual_takeoff_tx
  // by the time this runs — estimate_items.source_takeoff_id pointed at that
  // (now-gone) mirror id, which we don't have anymore directly, so we
  // recover it from the takeoff_item_history 'deleted' snapshot, scoped to
  // THIS manual takeoff via its own before-image (mirror rows carry
  // source_manual_takeoff_id) — narrower than scanning every deleted mirror
  // tenant-wide, and correct even if two different manual takeoffs happen
  // to be soft-deleted around the same time.
  const { data: historyRows, error: historyErr } = await db
    .from("takeoff_item_history")
    .select("takeoff_item_id")
    .eq("tenant_id", tenantId)
    .eq("action", "deleted")
    .filter("before->>source_manual_takeoff_id", "eq", manualTakeoffId);
  if (historyErr) throw new Error(historyErr.message ?? "failed to read takeoff history");
  if (!historyRows) return [];

  const deletedMirrorIds = new Set(
    (historyRows ?? [])
      .filter((h: { takeoff_item_id: string }) => Boolean(h.takeoff_item_id))
      .map((h: { takeoff_item_id: string }) => h.takeoff_item_id),
  );
  if (deletedMirrorIds.size === 0) return [];

  const { data: linkedItems, error: linkedErr } = await db
    .from("estimate_items")
    .select("id, estimate_version_id, source_takeoff_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("source_takeoff_id", [...deletedMirrorIds]);
  if (linkedErr) throw new Error(linkedErr.message ?? "failed to read synced estimate items");
  if (!linkedItems || linkedItems.length === 0) return [];

  const versionIds = [...new Set(linkedItems.map((i: { estimate_version_id: string }) => i.estimate_version_id))];
  const { data: versions, error: versionsErr } = await db.from("estimate_versions").select("id, status").in("id", versionIds);
  if (versionsErr) throw new Error(versionsErr.message ?? "failed to read estimate versions");
  const draftVersionIds = new Set((versions ?? []).filter((v: { status: string }) => v.status === "draft" || v.status === "review").map((v: { id: string }) => v.id));

  const toRemove = linkedItems.filter((i: { estimate_version_id: string }) => draftVersionIds.has(i.estimate_version_id));
  if (toRemove.length === 0) return [];

  const ids = toRemove.map((i: { id: string }) => i.id);
  const { data: snapshots, error: snapErr } = await db.from("estimate_items").select("*").in("id", ids);
  if (snapErr) throw new Error(snapErr.message ?? "failed to read estimate items before delete");
  const { error } = await db.from("estimate_items").delete().in("id", ids);
  if (error) throw new Error(error.message ?? "failed to remove synced estimate items");
  return (snapshots ?? []) as Record<string, unknown>[];
}

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
    id: string; tenant_id: string; project_id: string; manual_takeoff_id: string;
    event_type: "upsert" | "delete"; attempts: number;
  }>;
  result.claimed = events.length;

  for (const event of events) {
    try {
      if (event.event_type === "upsert") {
        await syncFn(event.tenant_id, event.project_id);
      } else {
        await reconcileDeletedTakeoffEstimateItems(db, event.tenant_id, event.project_id, event.manual_takeoff_id);
      }
      const { error } = await db.rpc("complete_outbox_event", { p_id: event.id });
      if (error) throw error;
      result.completed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const { error } = await db.rpc("fail_outbox_event", { p_id: event.id, p_error: message, p_max_attempts: MAX_ATTEMPTS });
      if (error) console.error("[outbox-worker] fail_outbox_event itself failed", error);
      if (event.attempts + 1 >= MAX_ATTEMPTS) result.deadLettered++;
      else result.failed++;
      result.errors.push({ id: event.id, error: message });
    }
  }

  return result;
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
): Promise<void> {
  // The mirror row itself is already hard-deleted by soft_delete_manual_takeoff_tx
  // by the time this runs — estimate_items.source_takeoff_id pointed at that
  // (now-gone) mirror id, which we don't have anymore directly, so we
  // recover it from the takeoff_item_history 'deleted' snapshot, scoped to
  // THIS manual takeoff via its own before-image (mirror rows carry
  // source_manual_takeoff_id) — narrower than scanning every deleted mirror
  // tenant-wide, and correct even if two different manual takeoffs happen
  // to be soft-deleted around the same time.
  const { data: historyRows } = await db
    .from("takeoff_item_history")
    .select("takeoff_item_id")
    .eq("tenant_id", tenantId)
    .eq("action", "deleted")
    .filter("before->>source_manual_takeoff_id", "eq", manualTakeoffId);
  const deletedMirrorIds = new Set(
    (historyRows ?? [])
      .filter((h: { takeoff_item_id: string }) => Boolean(h.takeoff_item_id))
      .map((h: { takeoff_item_id: string }) => h.takeoff_item_id),
  );
  if (deletedMirrorIds.size === 0) return;

  const { data: linkedItems } = await db
    .from("estimate_items")
    .select("id, estimate_version_id, source_takeoff_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("source_takeoff_id", [...deletedMirrorIds]);
  if (!linkedItems || linkedItems.length === 0) return;

  const versionIds = [...new Set(linkedItems.map((i: { estimate_version_id: string }) => i.estimate_version_id))];
  const { data: versions } = await db.from("estimate_versions").select("id, status").in("id", versionIds);
  const draftVersionIds = new Set((versions ?? []).filter((v: { status: string }) => v.status === "draft" || v.status === "review").map((v: { id: string }) => v.id));

  const toRemove = linkedItems.filter((i: { estimate_version_id: string }) => draftVersionIds.has(i.estimate_version_id));
  if (toRemove.length === 0) return;

  await db.from("estimate_items").delete().in("id", toRemove.map((i: { id: string }) => i.id));
}

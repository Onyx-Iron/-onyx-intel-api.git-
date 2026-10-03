/**
 * A failed outbox attempt must not leave a half-applied estimate sync.
 * Inserts from this attempt are removed. Rows this attempt deleted are put back.
 * The canvas save that queued the event is already committed and is left alone.
 */

export interface OutboxWriteUndo {
  insertedIds: string[];
  restoredRows: Record<string, unknown>[];
}

export function emptyOutboxUndo(): OutboxWriteUndo {
  return { insertedIds: [], restoredRows: [] };
}

/** A sync result that saved nothing and reported a write error must be retried, not completed. */
export function syncWriteFailure(value: unknown): { writeError: string; insertedIds: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { writeError?: unknown; insertedIds?: unknown };
  if (typeof row.writeError !== "string" || row.writeError.length === 0) return null;
  const insertedIds = Array.isArray(row.insertedIds)
    ? row.insertedIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  return { writeError: row.writeError, insertedIds };
}

export function insertedIdsFromSync(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const ids = (value as { insertedIds?: unknown }).insertedIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && id.length > 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function rollbackOutboxWrites(db: AnyDb, undo: OutboxWriteUndo): Promise<void> {
  if (undo.insertedIds.length > 0) {
    const { error } = await db.from("estimate_items").delete().in("id", undo.insertedIds);
    if (error) throw new Error(error.message ?? "failed to roll back inserted estimate items");
  }
  if (undo.restoredRows.length > 0) {
    const { error } = await db.from("estimate_items").insert(undo.restoredRows);
    if (error) throw new Error(error.message ?? "failed to restore estimate items removed by this attempt");
  }
}

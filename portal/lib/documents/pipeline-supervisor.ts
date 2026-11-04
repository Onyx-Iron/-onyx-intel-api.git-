/**
 * Which single step a non-terminal file gets on this supervisor run.
 * Password-protected and damaged files stop. Everything else gets one of
 * split, portal split, measurement, or deterministic takeoff, then stops
 * at the attempt cap.
 */

export const SUPERVISOR_ATTEMPT_CAP = 5;

/** A split batch that has not refreshed since this is treated as stalled. */
export const SPLIT_BATCH_STALE_MS = 15 * 60 * 1000;

export type SupervisorActionName =
  | "kick_split"
  | "portal_split"
  | "resume_split"
  | "measure"
  | "kick_takeoff"
  | "terminal"
  | "idle";

export interface SupervisorSnapshot {
  status: string;
  split_status?: string | null;
  pages_on_disk: number;
  measured: boolean;
  takeoff_done: boolean;
  attempts: number;
  last_error?: string | null;
  last_action?: string | null;
  /** Set while a page-split batch is still uploading. Null means the first batch has not checkpointed. */
  processing_started_at?: string | null;
}

export interface SupervisorDecision {
  action: SupervisorActionName;
  reason: string;
}

const TERMINAL_STATUS = new Set(["complete", "ready", "done"]);

export function isUnretryableDocumentError(error: string | null | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return lower.includes("password")
    || lower.includes("encrypt")
    || lower.includes("corrupt")
    || lower.includes("malformed");
}

/**
 * True when some pages are stored but the split worker has not finished the
 * deck. `processing` is the checkpoint the worker sets until the last batch.
 * Downstream measure/takeoff would close the set on that prefix.
 */
export function splitBatchStillOpen(doc: Pick<SupervisorSnapshot, "pages_on_disk" | "split_status">): boolean {
  if (doc.pages_on_disk <= 0) return false;
  return doc.split_status === "processing";
}

/**
 * A live first batch has no checkpoint yet, so a null start time is not stale.
 * Reclaim already moved error/failed files off the worker; those are stalled.
 */
export function splitBatchStale(
  doc: Pick<SupervisorSnapshot, "status" | "processing_started_at">,
  now = Date.now(),
): boolean {
  if (doc.status === "error" || doc.status === "failed") return true;
  if (!doc.processing_started_at) return false;
  const started = Date.parse(doc.processing_started_at);
  if (!Number.isFinite(started)) return true;
  return now - started >= SPLIT_BATCH_STALE_MS;
}

/** Continuation cursor saved by the page-split worker. Null starts the worker at page 1. */
export function resumeSplitPageFrom(summary: Record<string, unknown>): number | null {
  const raw = summary.next_page_from;
  const page = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isInteger(page) || page < 1) return null;
  return page;
}

export function nextSupervisorAction(doc: SupervisorSnapshot, now = Date.now()): SupervisorDecision {
  if (isUnretryableDocumentError(doc.last_error)) {
    return { action: "terminal", reason: "password_or_damaged" };
  }
  if (TERMINAL_STATUS.has(doc.status) && doc.measured && doc.takeoff_done) {
    return { action: "idle", reason: "already_finished" };
  }
  if (doc.attempts >= SUPERVISOR_ATTEMPT_CAP) {
    return { action: "terminal", reason: "attempt_cap" };
  }
  if (splitBatchStillOpen(doc)) {
    if (splitBatchStale(doc, now)) {
      return { action: "resume_split", reason: "split_batch_stalled" };
    }
    return { action: "idle", reason: "split_batch_in_flight" };
  }
  if (doc.pages_on_disk <= 0) {
    const workerAlreadyTried = doc.last_action === "kick_split"
      || doc.split_status === "error"
      || doc.split_status === "done";
    if (workerAlreadyTried) {
      return { action: "portal_split", reason: "edge_split_wrote_no_pages" };
    }
    return { action: "kick_split", reason: "split_pending" };
  }
  if (!doc.measured) {
    return { action: "measure", reason: "geometry_unread" };
  }
  if (!doc.takeoff_done) {
    return { action: "kick_takeoff", reason: "deterministic_takeoff" };
  }
  return { action: "idle", reason: "already_finished" };
}

/** Takeoff kicked by the supervisor is the deterministic extractor. It does not call a model. */
export function takeoffKickUsesModel(): boolean {
  return false;
}

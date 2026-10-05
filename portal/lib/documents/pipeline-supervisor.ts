/**
 * Which single step a non-terminal file gets on this supervisor run.
 * Password-protected and damaged files stop. Everything else gets one of
 * split, portal split, measurement, or deterministic takeoff, then stops
 * at the attempt cap.
 */

export const SUPERVISOR_ATTEMPT_CAP = 5;

/** How many documents one cron run will actually advance. */
export const SUPERVISOR_BATCH = 8;

/**
 * Oldest rows are scanned until the batch is full. Stopped files stay in the
 * status filter, so a hard limit of SUPERVISOR_BATCH would otherwise reread
 * the same stopped uploads and never reach a newer one.
 */
export const SUPERVISOR_SCAN_CAP = 400;

export type SupervisorActionName =
  | "kick_split"
  | "portal_split"
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

export function nextSupervisorAction(doc: SupervisorSnapshot): SupervisorDecision {
  if (isUnretryableDocumentError(doc.last_error)) {
    return { action: "terminal", reason: "password_or_damaged" };
  }
  if (TERMINAL_STATUS.has(doc.status) && doc.measured && doc.takeoff_done) {
    return { action: "idle", reason: "already_finished" };
  }
  if (doc.attempts >= SUPERVISOR_ATTEMPT_CAP) {
    return { action: "terminal", reason: "attempt_cap" };
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

/** True once the attempt cap or a damaged file has already stopped this document. */
export function supervisorAlreadyStopped(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const summary = (meta as { processing_summary?: unknown }).processing_summary;
  if (!summary || typeof summary !== "object") return false;
  return (summary as { last_supervisor_action?: unknown }).last_supervisor_action === "terminal";
}

/**
 * Walk oldest-first pages, skipping documents the supervisor has already
 * stopped, until `batchSize` actionable rows are collected.
 */
export async function collectActionableSupervisorDocs<T extends { meta?: unknown }>(
  loadPage: (offset: number, limit: number) => Promise<T[]>,
  batchSize = SUPERVISOR_BATCH,
  scanCap = SUPERVISOR_SCAN_CAP,
): Promise<T[]> {
  const picked: T[] = [];
  const pageSize = Math.max(1, batchSize);
  for (let offset = 0; picked.length < batchSize && offset < scanCap; offset += pageSize) {
    const page = await loadPage(offset, pageSize);
    for (const row of page) {
      if (supervisorAlreadyStopped(row.meta)) continue;
      picked.push(row);
      if (picked.length >= batchSize) break;
    }
    if (page.length < pageSize) break;
  }
  return picked;
}

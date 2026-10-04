/**
 * Which single step a non-terminal file gets on this supervisor run.
 * Password-protected and damaged files stop. Everything else gets one of
 * split, portal split, measurement, or deterministic takeoff, then stops
 * at the attempt cap.
 */

export const SUPERVISOR_ATTEMPT_CAP = 5;

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

export interface SupervisorStatusWrite {
  /** Columns written onto every document_pages row. Null leaves pages alone. */
  page: Record<string, unknown> | null;
  /** Status columns written onto the document. Null leaves status alone. */
  document: Record<string, unknown> | null;
}

/**
 * Status writes for one supervisor action.
 *
 * `kick_takeoff` only records that the measure pass finished. It must not
 * stamp `document_pages.takeoff_status` or `documents.status`. Those columns
 * belong to the per-page takeoff worker and OCR finalize. Closing them here
 * skips extraction and hides a plan that is still split, processing, or failed.
 */
export function supervisorStatusWrite(action: SupervisorActionName): SupervisorStatusWrite {
  switch (action) {
    case "terminal":
      return { page: null, document: { status: "failed", last_error_step: "supervisor" } };
    case "portal_split":
      return { page: null, document: { status: "split", split_status: "done" } };
    case "kick_split":
    case "measure":
    case "kick_takeoff":
    case "idle":
      return { page: null, document: null };
    default: {
      const _never: never = action;
      return _never;
    }
  }
}

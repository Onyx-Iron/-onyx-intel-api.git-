/** Canonical values written by new code paths. */
export const CANONICAL_SUCCESS = "complete";
export const CANONICAL_FAILURE = "error";

/** Terminal success statuses written by sync ingest or async split-status. */
export const TERMINAL_SUCCESS = new Set(["ready", "complete", "done"]);

/** Terminal failure statuses from ingest, workers, or reclaim. */
export const TERMINAL_FAILURE = new Set(["error", "failed"]);

/** Map legacy async statuses to canonical vocabulary for display. */
export function normalizeStatusForDisplay(status: string): string {
  if (status === "done") return CANONICAL_SUCCESS;
  if (status === "failed") return CANONICAL_FAILURE;
  return status;
}

/** Finalize parent document status after async page workers settle. */
export function finalizeAsyncDocumentStatus(args: {
  allFailed: boolean;
  partialErrors: boolean;
}): string {
  if (args.allFailed) return CANONICAL_FAILURE;
  if (args.partialErrors) return "complete_with_errors";
  return CANONICAL_SUCCESS;
}

/** Statuses that should keep UI polling active. */
export const IN_FLIGHT = new Set(["pending", "processing", "split", "queued"]);

export function isTerminalSuccess(status: string): boolean {
  return TERMINAL_SUCCESS.has(status) || status === "complete_with_errors";
}

export function isTerminalFailure(status: string): boolean {
  return TERMINAL_FAILURE.has(status);
}

export function isInFlightStatus(status: string): boolean {
  return IN_FLIGHT.has(status);
}

export function isRetryable(status: string): boolean {
  return isTerminalFailure(status) || status === "complete_with_errors";
}

export function statusLabel(status: string): string {
  const normalized = normalizeStatusForDisplay(status);
  if (normalized === "complete_with_errors") return "Partial";
  if (status === "split") return "Splitting pages";
  if (status === "queued") return "Queued";
  if (status === "processing" || status === "pending") return "Processing";
  if (normalized === CANONICAL_FAILURE) return "Failed";
  if (normalized === CANONICAL_SUCCESS) return "Complete";
  return normalized;
}

export function needsSplitStatusPoll(args: {
  status: string;
  split_status?: string | null;
}): boolean {
  if (isTerminalSuccess(args.status) || isTerminalFailure(args.status)) return false;
  if (args.status === "split" || args.status === "queued") return true;
  const split = args.split_status;
  return split === "pending" || split === "processing";
}

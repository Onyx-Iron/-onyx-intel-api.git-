/** Terminal success statuses written by sync ingest or async split-status. */
export const TERMINAL_SUCCESS = new Set(["ready", "complete", "done"]);

/** Terminal failure statuses from ingest, workers, or reclaim. */
export const TERMINAL_FAILURE = new Set(["error", "failed"]);

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
  return isTerminalFailure(status);
}

export function statusLabel(status: string): string {
  if (status === "complete_with_errors") return "Partial";
  if (status === "split") return "Splitting pages";
  if (status === "queued") return "Queued";
  if (status === "processing" || status === "pending") return "Processing";
  if (status === "failed") return "Failed";
  return status;
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

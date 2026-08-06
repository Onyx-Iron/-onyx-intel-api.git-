export const SPLIT_START_TIMEOUT_MS = 8 * 60 * 1000;

export function isSplitStartStale(args: {
  status: string;
  updatedAt?: string | null;
  uploadedAt?: string | null;
  nowMs?: number;
}): boolean {
  if (["done", "failed", "error"].includes(args.status)) return false;
  const timestamp = Date.parse(args.updatedAt ?? args.uploadedAt ?? "");
  if (!Number.isFinite(timestamp)) return false;
  return (args.nowMs ?? Date.now()) - timestamp > SPLIT_START_TIMEOUT_MS;
}

export function finalSplitStatus(done: number, errored: number, total: number): "done" | "failed" | null {
  if (total <= 0 || done + errored !== total) return null;
  return errored === total ? "failed" : "done";
}

/**
 * Pure helpers for per-page OCR / takeoff retry decisions.
 */

import type { PageWorkerKind } from "./pageWorkers.ts";

export type RetryablePageRow = {
  id: string;
  status: string | null;
  takeoff_status: string | null;
  storage_path: string | null;
  page_number: number;
  document_id: string;
  tenant_id: string;
};

export type RetryStagesResult = {
  stages: PageWorkerKind[];
  /** Patch applied to document_pages before re-invoking workers. */
  pagePatch: Record<string, unknown>;
};

/**
 * Decide which workers to re-fire for a failed page.
 * - Default: retry every stage currently in `error`.
 * - Explicit `requested` overrides (must still be failed or forceable).
 */
export function planPageRetry(
  page: RetryablePageRow,
  requested?: PageWorkerKind[] | null,
): RetryStagesResult | { error: string } {
  if (!page.storage_path) {
    return { error: "Page has no storage_path — cannot retry" };
  }

  const ocrFailed = page.status === "error";
  const takeoffFailed = page.takeoff_status === "error";

  let stages: PageWorkerKind[];
  if (requested && requested.length > 0) {
    stages = [...new Set(requested)];
    for (const s of stages) {
      if (s === "ocr" && !ocrFailed) {
        return { error: "OCR stage is not in error — cannot retry OCR" };
      }
      if (s === "takeoff" && !takeoffFailed) {
        return { error: "Takeoff stage is not in error — cannot retry takeoff" };
      }
    }
  } else {
    stages = [];
    if (ocrFailed) stages.push("ocr");
    if (takeoffFailed) stages.push("takeoff");
  }

  if (stages.length === 0) {
    return { error: "Page has no failed OCR or takeoff stage to retry" };
  }

  const pagePatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (stages.includes("ocr")) {
    pagePatch.status = "pending";
    pagePatch.error = null;
  }
  if (stages.includes("takeoff")) {
    pagePatch.takeoff_status = "pending";
    pagePatch.takeoff_error = null;
  }

  return { stages, pagePatch };
}

/** Parent docs that should leave terminal failure so list polling resumes. */
export function documentStatusAfterPageRetry(currentStatus: string): string | null {
  if (
    currentStatus === "error"
    || currentStatus === "failed"
    || currentStatus === "complete_with_errors"
  ) {
    return "split";
  }
  return null;
}

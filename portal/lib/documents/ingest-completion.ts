/**
 * Sync ingest used to mark a PDF complete whenever every page had text,
 * even if geometry measurement threw. That status is terminal: ingest
 * skips it, and the document supervisor never selects it, so the catch
 * path that logs "will retry" never runs. A failure inside
 * saveMeasuredPages has already deleted the previous suggested quantities.
 */

export interface IngestCompletionInput {
  /** True for a PDF that this run tried to measure. Specs and other files are not. */
  geometryRequired: boolean;
  geometryMeasured: boolean;
  missingPages: number[];
}

export interface IngestCompletion {
  status: "complete" | "processing";
  processedAt: boolean;
  lastError: string | null;
  lastErrorStep: "measure" | "parse" | null;
  takeoffDone: boolean;
}

export function ingestCompletion(input: IngestCompletionInput): IngestCompletion {
  const missing = input.missingPages.filter((page) => Number.isInteger(page) && page > 0);
  const geometryPending = input.geometryRequired && !input.geometryMeasured;
  if (geometryPending) {
    const missingNote = missing.length > 0 ? ` Missing pages: ${missing.join(", ")}.` : "";
    return {
      status: "processing",
      processedAt: false,
      lastError: `Sheet geometry was not saved.${missingNote} Processing will retry.`,
      lastErrorStep: "measure",
      takeoffDone: false,
    };
  }
  if (!input.geometryMeasured && missing.length > 0) {
    return {
      status: "processing",
      processedAt: false,
      lastError: `Missing pages: ${missing.join(", ")}`,
      lastErrorStep: "parse",
      takeoffDone: false,
    };
  }
  return {
    status: "complete",
    processedAt: true,
    lastError: null,
    lastErrorStep: null,
    takeoffDone: input.geometryMeasured,
  };
}

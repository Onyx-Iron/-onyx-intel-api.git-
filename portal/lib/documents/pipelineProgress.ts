/** Pure helpers for rolling up OCR + takeoff page progress. */

export type PageProgressRow = {
  id: string;
  page_number: number;
  status: string | null;
  error?: string | null;
  takeoff_status: string | null;
  takeoff_error?: string | null;
  storage_path?: string | null;
};

export type StageCounts = {
  total: number;
  done: number;
  error: number;
  pending: number;
  processing: number;
};

export type PipelineProgress = {
  ocr: StageCounts;
  takeoff: StageCounts;
  failed_pages: Array<{
    id: string;
    page_number: number;
    ocr_failed: boolean;
    takeoff_failed: boolean;
    error: string | null;
    takeoff_error: string | null;
  }>;
  /** True when both OCR and takeoff have no in-flight pages (all terminal or empty). */
  finished: boolean;
};

const OCR_DONE = new Set(["done"]);
const OCR_ERROR = new Set(["error"]);
const OCR_PROCESSING = new Set(["processing"]);
const TAKEOFF_DONE = new Set(["done", "skipped"]);
const TAKEOFF_ERROR = new Set(["error"]);
const TAKEOFF_PROCESSING = new Set(["processing"]);

function countStage(
  rows: PageProgressRow[],
  pick: (r: PageProgressRow) => string | null,
  done: Set<string>,
  errored: Set<string>,
  processing: Set<string>,
): StageCounts {
  let doneN = 0;
  let errorN = 0;
  let processingN = 0;
  let pendingN = 0;
  for (const r of rows) {
    const s = pick(r) ?? "pending";
    if (done.has(s)) doneN += 1;
    else if (errored.has(s)) errorN += 1;
    else if (processing.has(s)) processingN += 1;
    else pendingN += 1;
  }
  return {
    total: rows.length,
    done: doneN,
    error: errorN,
    pending: pendingN,
    processing: processingN,
  };
}

export function summarizePipelineProgress(rows: PageProgressRow[]): PipelineProgress {
  const ocr = countStage(rows, (r) => r.status, OCR_DONE, OCR_ERROR, OCR_PROCESSING);
  const takeoff = countStage(
    rows,
    (r) => r.takeoff_status,
    TAKEOFF_DONE,
    TAKEOFF_ERROR,
    TAKEOFF_PROCESSING,
  );

  const failed_pages = rows
    .filter((r) => r.status === "error" || r.takeoff_status === "error")
    .map((r) => ({
      id: r.id,
      page_number: r.page_number,
      ocr_failed: r.status === "error",
      takeoff_failed: r.takeoff_status === "error",
      error: r.error ?? null,
      takeoff_error: r.takeoff_error ?? null,
    }))
    .sort((a, b) => a.page_number - b.page_number);

  const ocrInFlight = ocr.pending + ocr.processing;
  const takeoffInFlight = takeoff.pending + takeoff.processing;
  const finished = rows.length === 0
    ? false
    : ocrInFlight === 0 && takeoffInFlight === 0;

  return { ocr, takeoff, failed_pages, finished };
}

export function formatStageProgress(label: string, stage: StageCounts): string {
  if (stage.total === 0) return `${label} —`;
  const settled = stage.done + stage.error;
  if (stage.error > 0) return `${label} ${settled}/${stage.total} (${stage.error} err)`;
  return `${label} ${settled}/${stage.total}`;
}

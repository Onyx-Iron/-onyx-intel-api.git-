/**
 * Finalize documents.status once every split page has a terminal OCR status
 * (and takeoff is not still mid-flight). Takeoff also finalizes via
 * /api/takeoff/split-status; Documents list/retry must not leave
 * status="split" forever after OCR completes, nor mark complete while
 * takeoff pages are still processing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

const TERMINAL_DOC = new Set([
  "complete",
  "ready",
  "done",
  "failed",
  "error",
  "complete_with_errors",
]);

const TERMINAL_TAKEOFF = new Set(["done", "error", "skipped"]);

export type FinalizeResult = {
  documentId: string;
  status: string;
  pagesTotal: number;
  pagesOcrOk: number;
  pagesOcrError: number;
};

/**
 * For docs still in split/processing/queued, roll up document_pages OCR
 * terminals into documents.status. Idempotent.
 */
export async function finalizeDocumentsFromOcr(
  db: AnyDb,
  tenantId: string,
  documentIds?: string[],
  projectId?: string | null,
): Promise<FinalizeResult[]> {
  let docsQ = db
    .from("documents")
    .select("id, status, page_count, meta")
    .eq("tenant_id", tenantId)
    .in("status", ["split", "processing", "queued"]);
  if (projectId) {
    docsQ = docsQ.eq("project_id", projectId);
  }
  if (documentIds?.length) {
    docsQ = docsQ.in("id", documentIds);
  }
  const { data: docs, error: docsErr } = await docsQ;
  if (docsErr) {
    console.error("[finalizeDocumentsFromOcr] list docs", docsErr);
    return [];
  }
  if (!docs?.length) return [];

  const ids = (docs as Array<{ id: string }>).map((d) => d.id);
  const { data: pages, error: pagesErr } = await db
    .from("document_pages")
    .select("document_id, status, takeoff_status")
    .eq("tenant_id", tenantId)
    .in("document_id", ids);
  if (pagesErr) {
    console.error("[finalizeDocumentsFromOcr] list pages", pagesErr);
    return [];
  }

  const byDoc = new Map<string, {
    total: number;
    done: number;
    errored: number;
    takeoffInFlight: number;
    takeoffError: number;
  }>();
  for (const p of (pages ?? []) as Array<{
    document_id: string;
    status: string | null;
    takeoff_status: string | null;
  }>) {
    const cur = byDoc.get(p.document_id) ?? {
      total: 0, done: 0, errored: 0, takeoffInFlight: 0, takeoffError: 0,
    };
    cur.total += 1;
    if (p.status === "done") cur.done += 1;
    else if (p.status === "error") cur.errored += 1;
    if (p.takeoff_status === "pending" || p.takeoff_status === "processing") {
      cur.takeoffInFlight += 1;
    } else if (p.takeoff_status === "error") {
      cur.takeoffError += 1;
    } else if (p.takeoff_status && !TERMINAL_TAKEOFF.has(p.takeoff_status)) {
      cur.takeoffInFlight += 1;
    }
    byDoc.set(p.document_id, cur);
  }

  const results: FinalizeResult[] = [];
  const now = new Date().toISOString();

  for (const doc of docs as Array<{ id: string; status: string; page_count: number | null; meta: unknown }>) {
    if (TERMINAL_DOC.has(String(doc.status))) continue;
    const stats = byDoc.get(doc.id);
    if (!stats || stats.total === 0) continue;
    const settled = stats.done + stats.errored;
    if (settled !== stats.total) continue;
    // Don't terminalize parent while takeoff workers are still running —
    // otherwise Documents flips to complete and Takeoff split-status skips.
    if (stats.takeoffInFlight > 0) continue;

    const prevMeta = (doc.meta && typeof doc.meta === "object")
      ? doc.meta as Record<string, unknown>
      : {};
    const prevSummary = (typeof prevMeta.processing_summary === "object" && prevMeta.processing_summary)
      ? prevMeta.processing_summary as Record<string, unknown>
      : {};

    // Split may omit pages whose storage upload failed — those never get a
    // document_pages row. Treat missing pages as errors so we don't mark a
    // clean "complete" that hides lost sheets and disables Retry.
    const expectedPages = typeof doc.page_count === "number" && doc.page_count > 0
      ? doc.page_count
      : stats.total;
    const failedUploads = typeof prevSummary.failed_uploads === "number"
      ? prevSummary.failed_uploads
      : 0;
    const missingPages = Math.max(0, expectedPages - stats.total, failedUploads);
    const effectiveErrors = stats.errored + missingPages + stats.takeoffError;

    const finalStatus = effectiveErrors >= expectedPages && stats.done === 0
      ? "failed"
      : effectiveErrors > 0
        ? "complete_with_errors"
        : "complete";

    const errorParts: string[] = [];
    if (stats.errored > 0) errorParts.push(`${stats.errored} of ${stats.total} page(s) failed OCR`);
    if (stats.takeoffError > 0) errorParts.push(`${stats.takeoffError} page(s) failed takeoff`);
    if (missingPages > 0) errorParts.push(`${missingPages} page(s) missing after split`);

    const ocrStatus = stats.errored === 0 && missingPages === 0
      ? "done"
      : stats.done > 0
        ? "partially_completed"
        : "error";
    const takeoffStatus = stats.takeoffError === 0
      ? "done"
      : stats.takeoffError < stats.total
        ? "partially_completed"
        : "error";

    const { error: updErr } = await db.from("documents").update({
      status: finalStatus,
      split_status: "done",
      ocr_status: ocrStatus,
      takeoff_status: takeoffStatus,
      processed_at: now,
      // Keep the expected PDF page count when split recorded it; otherwise
      // fall back to rows that actually exist.
      page_count: expectedPages,
      last_error: errorParts.length ? errorParts.join("; ") : null,
      last_error_step: errorParts.length
        ? (stats.errored > 0 ? "ocr" : stats.takeoffError > 0 ? "takeoff" : "split")
        : null,
      meta: {
        ...prevMeta,
        processing_summary: {
          ...prevSummary,
          pages_total: expectedPages,
          pages_ocr_ok: stats.done,
          pages_ocr_failed: stats.errored,
          pages_takeoff_failed: stats.takeoffError,
          pages_missing: missingPages,
          ocr_finalized_at: now,
        },
      },
    }).eq("id", doc.id).eq("tenant_id", tenantId);

    if (updErr) {
      console.error("[finalizeDocumentsFromOcr] update", doc.id, updErr);
      continue;
    }
    results.push({
      documentId: doc.id,
      status: finalStatus,
      pagesTotal: stats.total,
      pagesOcrOk: stats.done,
      pagesOcrError: stats.errored,
    });
  }

  return results;
}

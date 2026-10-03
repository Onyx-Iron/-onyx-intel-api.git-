/**
 * Finalize documents.status once every split page has a terminal OCR status.
 * Takeoff still finalizes via /api/takeoff/split-status; Documents list/retry
 * must not leave status="split" forever after OCR completes.
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
): Promise<FinalizeResult[]> {
  let docsQ = db
    .from("documents")
    .select("id, status, meta")
    .eq("tenant_id", tenantId)
    .in("status", ["split", "processing", "queued"]);
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
    .select("document_id, status")
    .eq("tenant_id", tenantId)
    .in("document_id", ids);
  if (pagesErr) {
    console.error("[finalizeDocumentsFromOcr] list pages", pagesErr);
    return [];
  }

  const byDoc = new Map<string, { total: number; done: number; errored: number }>();
  for (const p of (pages ?? []) as Array<{ document_id: string; status: string | null }>) {
    const cur = byDoc.get(p.document_id) ?? { total: 0, done: 0, errored: 0 };
    cur.total += 1;
    if (p.status === "done") cur.done += 1;
    else if (p.status === "error") cur.errored += 1;
    byDoc.set(p.document_id, cur);
  }

  const results: FinalizeResult[] = [];
  const now = new Date().toISOString();

  for (const doc of docs as Array<{ id: string; status: string; meta: unknown }>) {
    if (TERMINAL_DOC.has(String(doc.status))) continue;
    const stats = byDoc.get(doc.id);
    if (!stats || stats.total === 0) continue;
    const settled = stats.done + stats.errored;
    if (settled !== stats.total) continue;

    const finalStatus = stats.errored === stats.total
      ? "failed"
      : stats.errored > 0
        ? "complete_with_errors"
        : "complete";

    const prevMeta = (doc.meta && typeof doc.meta === "object")
      ? doc.meta as Record<string, unknown>
      : {};
    const prevSummary = (typeof prevMeta.processing_summary === "object" && prevMeta.processing_summary)
      ? prevMeta.processing_summary as Record<string, unknown>
      : {};

    const { error: updErr } = await db.from("documents").update({
      status: finalStatus,
      split_status: "done",
      ocr_status: stats.errored === 0
        ? "done"
        : stats.done > 0
          ? "partially_completed"
          : "error",
      processed_at: now,
      page_count: stats.total,
      last_error: stats.errored > 0
        ? `${stats.errored} of ${stats.total} page(s) failed OCR`
        : null,
      last_error_step: stats.errored > 0 ? "ocr" : null,
      meta: {
        ...prevMeta,
        processing_summary: {
          ...prevSummary,
          pages_total: stats.total,
          pages_ocr_ok: stats.done,
          pages_ocr_failed: stats.errored,
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

/**
 * Sheet-index worker: claims uncalibrated sheets via `claim_unparsed_sheets`
 * (FOR UPDATE SKIP LOCKED) and marks structural indexing complete once the
 * page link exists. User calibration (`is_calibrated`) is separate and
 * remains false until a verified sheet_calibration is saved.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface SheetProcessResult {
  claimed: number;
  completed: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export interface ProcessSheetBatchOptions {
  batchSize?: number;
  visibilityTimeoutSeconds?: number;
}

export async function processSheetBatch(
  db: AnyDb,
  workerId: string,
  options: ProcessSheetBatchOptions = {},
): Promise<SheetProcessResult> {
  const batchSize = options.batchSize ?? 20;
  const visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 120;

  const result: SheetProcessResult = { claimed: 0, completed: 0, failed: 0, errors: [] };

  const { data: claimed, error: claimErr } = await db.rpc("claim_unparsed_sheets", {
    p_limit: batchSize,
    p_worker_id: workerId,
    p_visibility_timeout_seconds: visibilityTimeoutSeconds,
  });
  if (claimErr) throw claimErr;

  const sheets = (claimed ?? []) as Array<{
    id: string;
    tenant_id: string;
    project_id: string;
    document_id: string;
    document_page_id: string | null;
    page_number: number | null;
  }>;
  result.claimed = sheets.length;

  const documentIds = new Set<string>();

  for (const sheet of sheets) {
    documentIds.add(sheet.document_id);
    try {
      if (!sheet.document_page_id) {
        throw new Error("sheet has no document_page_id — cannot index");
      }

      const { error: completeErr } = await db.rpc("complete_sheet_processing", { p_id: sheet.id });
      if (completeErr) throw completeErr;

      await db.from("document_processing_events").insert({
        tenant_id: sheet.tenant_id,
        project_id: sheet.project_id,
        document_id: sheet.document_id,
        document_page_id: sheet.document_page_id,
        step: "sheet_index",
        status: "succeeded",
        worker: workerId,
        completed_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});

      result.completed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.errors.push({ id: sheet.id, error: message });

      await db.rpc("fail_sheet_processing", { p_id: sheet.id, p_error: message.slice(0, 500) }).catch(() => {});

      await db.from("document_processing_events").insert({
        tenant_id: sheet.tenant_id,
        project_id: sheet.project_id,
        document_id: sheet.document_id,
        document_page_id: sheet.document_page_id,
        step: "sheet_index",
        status: "failed",
        worker: workerId,
        error_message: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
      }).then(() => {}).catch(() => {});
    }
  }

  await Promise.all(
    [...documentIds].map((documentId) =>
      db.rpc("refresh_sheet_index_status", { p_document_id: documentId }).catch(() => {}),
    ),
  );

  return result;
}

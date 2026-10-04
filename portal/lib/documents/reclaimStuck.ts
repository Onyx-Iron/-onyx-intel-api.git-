/**
 * Marks documents / pages stuck in processing as error so users can retry.
 * Vercel/Edge kills leave orphans without catch handlers; list + split-status
 * polls reclaim them opportunistically.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Default: 10 minutes — well above normal ingest, below "forgotten forever". */
export const STUCK_PROCESSING_MS = 10 * 60 * 1000;

/** Queued docs with no worker progress after this are treated as abandoned. */
export const STUCK_QUEUED_MS = 15 * 60 * 1000;

/** Pending pages that never got a processor claim after this are abandoned. */
export const STUCK_PENDING_PAGE_MS = 15 * 60 * 1000;

export async function reclaimStuckProcessingDocuments(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  // Prefer processing_started_at so long Drive uploads that only later enter
  // processing aren't falsely reclaimed based on uploaded_at alone.
  // Do NOT reclaim status="split" here — kick time is often >10m before OCR
  // finishes on large plans. Stuck pages are reclaimed separately; OCR
  // finalize then rolls the parent to complete / complete_with_errors / error.
  const { data: byStart, error: startErr } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Processing timed out or was interrupted. Retry ingest to continue.",
      last_error_step: "stuck_processing_reclaim",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .not("processing_started_at", "is", null)
    .lt("processing_started_at", cutoff)
    .select("id");

  if (startErr) console.error("[reclaimStuckProcessingDocuments:started]", startErr);

  // Fallback: processing rows that never got processing_started_at set.
  const { data: byUpload, error: uploadErr } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Processing timed out or was interrupted. Retry ingest to continue.",
      last_error_step: "stuck_processing_reclaim",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .is("processing_started_at", null)
    .lt("uploaded_at", cutoff)
    .select("id");

  if (uploadErr) console.error("[reclaimStuckProcessingDocuments:uploaded]", uploadErr);

  // Stale queued / pending — use kick time (processing_started_at) so a Retry
  // on an old upload isn't immediately reclaimed via the original uploaded_at.
  const queuedCutoff = new Date(Date.now() - STUCK_QUEUED_MS).toISOString();
  const { data: queuedByKick, error: queuedKickErr } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Upload was queued but processing never started. Retry ingest or re-upload.",
      last_error_step: "stuck_queued_reclaim",
    })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "pending"])
    .not("processing_started_at", "is", null)
    .lt("processing_started_at", queuedCutoff)
    .select("id");

  if (queuedKickErr) console.error("[reclaimStuckProcessingDocuments:queuedKick]", queuedKickErr);

  const { data: queuedByUpload, error: queuedUploadErr } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Upload was queued but processing never started. Retry ingest or re-upload.",
      last_error_step: "stuck_queued_reclaim",
    })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "pending"])
    .is("processing_started_at", null)
    .lt("uploaded_at", queuedCutoff)
    .select("id");

  if (queuedUploadErr) console.error("[reclaimStuckProcessingDocuments:queuedUpload]", queuedUploadErr);

  return (byStart?.length ?? 0)
    + (byUpload?.length ?? 0)
    + (queuedByKick?.length ?? 0)
    + (queuedByUpload?.length ?? 0);
}

/**
 * Reclaims document_pages stuck in OCR (`status=processing` / stale `pending`)
 * or takeoff (`takeoff_status=processing` / stale `pending`).
 */
export async function reclaimStuckProcessingPages(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
  documentId?: string,
): Promise<{ statusReclaimed: number; takeoffReclaimed: number; pendingReclaimed: number }> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const pendingCutoff = new Date(Date.now() - STUCK_PENDING_PAGE_MS).toISOString();
  const now = new Date().toISOString();

  let statusQ = db
    .from("document_pages")
    .update({
      status: "error",
      error: "Page processing timed out or was interrupted. Retry ingest to continue.",
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .lt("updated_at", cutoff);
  if (documentId) statusQ = statusQ.eq("document_id", documentId);

  // Fire-and-forget fan-out can fail to reach page-processor — reclaim stale
  // pending pages so finalize / Retry can surface them.
  let pendingQ = db
    .from("document_pages")
    .update({
      status: "error",
      error: "Page was never claimed by a processor. Retry ingest to continue.",
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .lt("updated_at", pendingCutoff);
  if (documentId) pendingQ = pendingQ.eq("document_id", documentId);

  let takeoffQ = db
    .from("document_pages")
    .update({
      takeoff_status: "error",
      takeoff_error: "Takeoff processing timed out or was interrupted. Retry to continue.",
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("takeoff_status", "processing")
    .lt("updated_at", cutoff);
  if (documentId) takeoffQ = takeoffQ.eq("document_id", documentId);

  // Same hole as stale OCR pending: a failed fan-out or page retry sets
  // takeoff_status=pending and then never reaches the worker. Nothing else
  // polls that state, so the page stays pending and Retry will not offer it.
  let takeoffPendingQ = db
    .from("document_pages")
    .update({
      takeoff_status: "error",
      takeoff_error: "Takeoff was never claimed by a processor. Retry to continue.",
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("takeoff_status", "pending")
    .lt("updated_at", pendingCutoff);
  if (documentId) takeoffPendingQ = takeoffPendingQ.eq("document_id", documentId);

  const [statusRes, pendingRes, takeoffRes, takeoffPendingRes] = await Promise.all([
    statusQ.select("id"),
    pendingQ.select("id"),
    takeoffQ.select("id"),
    takeoffPendingQ.select("id"),
  ]);

  if (statusRes.error) console.error("[reclaimStuckProcessingPages:status]", statusRes.error);
  if (pendingRes.error) console.error("[reclaimStuckProcessingPages:pending]", pendingRes.error);
  if (takeoffRes.error) console.error("[reclaimStuckProcessingPages:takeoff]", takeoffRes.error);
  if (takeoffPendingRes.error) console.error("[reclaimStuckProcessingPages:takeoffPending]", takeoffPendingRes.error);

  return {
    statusReclaimed: statusRes.error ? 0 : (statusRes.data ?? []).length,
    pendingReclaimed: pendingRes.error ? 0 : (pendingRes.data ?? []).length,
    takeoffReclaimed: (takeoffRes.error ? 0 : (takeoffRes.data ?? []).length)
      + (takeoffPendingRes.error ? 0 : (takeoffPendingRes.data ?? []).length),
  };
}

/**
 * Reclaims sheets stuck in `processing_status=processing` after a worker
 * crash or platform kill left claimed_at set without completion.
 */
export async function reclaimStuckProcessingSheets(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("sheets")
    .update({
      processing_status: "error",
      claimed_at: null,
      claimed_by: null,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("processing_status", "processing")
    .lt("updated_at", cutoff)
    .select("id");

  if (error) {
    throw new Error(`[reclaimStuckProcessingSheets] ${error.message}`);
  }
  return (data ?? []).length;
}

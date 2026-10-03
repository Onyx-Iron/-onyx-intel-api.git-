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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopeProject(q: any, projectId?: string | null) {
  return projectId ? q.eq("project_id", projectId) : q;
}

export async function reclaimStuckProcessingDocuments(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
  projectId?: string | null,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  // Prefer processing_started_at so long Drive uploads that only later enter
  // processing aren't falsely reclaimed based on uploaded_at alone.
  // Do NOT reclaim status="split" here — kick time is often >10m before OCR
  // finishes on large plans. Stuck pages are reclaimed separately; OCR
  // finalize then rolls the parent to complete / complete_with_errors / error.
  let byStartQ = db
    .from("documents")
    .update({
      status: "error",
      last_error: "Processing timed out or was interrupted. Retry ingest to continue.",
      last_error_step: "stuck_processing_reclaim",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .not("processing_started_at", "is", null)
    .lt("processing_started_at", cutoff);
  byStartQ = scopeProject(byStartQ, projectId);
  const { data: byStart, error: startErr } = await byStartQ.select("id");

  if (startErr) console.error("[reclaimStuckProcessingDocuments:started]", startErr);

  // Fallback: processing rows that never got processing_started_at set.
  let byUploadQ = db
    .from("documents")
    .update({
      status: "error",
      last_error: "Processing timed out or was interrupted. Retry ingest to continue.",
      last_error_step: "stuck_processing_reclaim",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .is("processing_started_at", null)
    .lt("uploaded_at", cutoff);
  byUploadQ = scopeProject(byUploadQ, projectId);
  const { data: byUpload, error: uploadErr } = await byUploadQ.select("id");

  if (uploadErr) console.error("[reclaimStuckProcessingDocuments:uploaded]", uploadErr);

  // Stale queued / pending — use kick time (processing_started_at) so a Retry
  // on an old upload isn't immediately reclaimed via the original uploaded_at.
  const queuedCutoff = new Date(Date.now() - STUCK_QUEUED_MS).toISOString();
  let queuedByKickQ = db
    .from("documents")
    .update({
      status: "error",
      last_error: "Upload was queued but processing never started. Retry ingest or re-upload.",
      last_error_step: "stuck_queued_reclaim",
    })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "pending"])
    .not("processing_started_at", "is", null)
    .lt("processing_started_at", queuedCutoff);
  queuedByKickQ = scopeProject(queuedByKickQ, projectId);
  const { data: queuedByKick, error: queuedKickErr } = await queuedByKickQ.select("id");

  if (queuedKickErr) console.error("[reclaimStuckProcessingDocuments:queuedKick]", queuedKickErr);

  let queuedByUploadQ = db
    .from("documents")
    .update({
      status: "error",
      last_error: "Upload was queued but processing never started. Retry ingest or re-upload.",
      last_error_step: "stuck_queued_reclaim",
    })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "pending"])
    .is("processing_started_at", null)
    .lt("uploaded_at", queuedCutoff);
  queuedByUploadQ = scopeProject(queuedByUploadQ, projectId);
  const { data: queuedByUpload, error: queuedUploadErr } = await queuedByUploadQ.select("id");

  if (queuedUploadErr) console.error("[reclaimStuckProcessingDocuments:queuedUpload]", queuedUploadErr);

  return (byStart?.length ?? 0)
    + (byUpload?.length ?? 0)
    + (queuedByKick?.length ?? 0)
    + (queuedByUpload?.length ?? 0);
}

/**
 * Reclaims document_pages stuck in OCR (`status=processing` / stale `pending`)
 * or takeoff (`takeoff_status=processing`).
 */
export async function reclaimStuckProcessingPages(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
  documentId?: string,
  projectId?: string | null,
): Promise<{ statusReclaimed: number; takeoffReclaimed: number; pendingReclaimed: number }> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const pendingCutoff = new Date(Date.now() - STUCK_PENDING_PAGE_MS).toISOString();
  const now = new Date().toISOString();

  let documentIds: string[] | null = null;
  if (!documentId && projectId) {
    const { data: docs } = await db
      .from("documents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("status", ["processing", "split", "queued", "pending", "complete_with_errors", "error", "failed"]);
    documentIds = ((docs ?? []) as Array<{ id: string }>).map((d) => d.id);
    if (documentIds.length === 0) {
      return { statusReclaimed: 0, takeoffReclaimed: 0, pendingReclaimed: 0 };
    }
  }

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
  else if (documentIds) statusQ = statusQ.in("document_id", documentIds);

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
  else if (documentIds) pendingQ = pendingQ.in("document_id", documentIds);

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
  else if (documentIds) takeoffQ = takeoffQ.in("document_id", documentIds);

  const [statusRes, pendingRes, takeoffRes] = await Promise.all([
    statusQ.select("id"),
    pendingQ.select("id"),
    takeoffQ.select("id"),
  ]);

  if (statusRes.error) console.error("[reclaimStuckProcessingPages:status]", statusRes.error);
  if (pendingRes.error) console.error("[reclaimStuckProcessingPages:pending]", pendingRes.error);
  if (takeoffRes.error) console.error("[reclaimStuckProcessingPages:takeoff]", takeoffRes.error);

  return {
    statusReclaimed: statusRes.error ? 0 : (statusRes.data ?? []).length,
    pendingReclaimed: pendingRes.error ? 0 : (pendingRes.data ?? []).length,
    takeoffReclaimed: takeoffRes.error ? 0 : (takeoffRes.data ?? []).length,
  };
}

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

export async function reclaimStuckProcessingDocuments(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();

  // Prefer processing_started_at so long Drive uploads that only later enter
  // processing aren't falsely reclaimed based on uploaded_at alone.
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

  // Stale queued / pending with no page progress — abandoned upload-url or
  // worker invoke that never started.
  const queuedCutoff = new Date(Date.now() - STUCK_QUEUED_MS).toISOString();
  const { data: queued, error: queuedErr } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Upload was queued but processing never started. Retry ingest or re-upload.",
      last_error_step: "stuck_queued_reclaim",
    })
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "pending"])
    .lt("uploaded_at", queuedCutoff)
    .select("id");

  if (queuedErr) console.error("[reclaimStuckProcessingDocuments:queued]", queuedErr);

  return (byStart?.length ?? 0) + (byUpload?.length ?? 0) + (queued?.length ?? 0);
}

/**
 * Reclaims document_pages stuck in OCR (`status=processing`) or takeoff
 * (`takeoff_status=processing`).
 */
export async function reclaimStuckProcessingPages(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
  documentId?: string,
): Promise<{ statusReclaimed: number; takeoffReclaimed: number }> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
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

  const [statusRes, takeoffRes] = await Promise.all([
    statusQ.select("id"),
    takeoffQ.select("id"),
  ]);

  if (statusRes.error) console.error("[reclaimStuckProcessingPages:status]", statusRes.error);
  if (takeoffRes.error) console.error("[reclaimStuckProcessingPages:takeoff]", takeoffRes.error);

  return {
    statusReclaimed: statusRes.error ? 0 : (statusRes.data ?? []).length,
    takeoffReclaimed: takeoffRes.error ? 0 : (takeoffRes.data ?? []).length,
  };
}

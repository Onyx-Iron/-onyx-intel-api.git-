/**
 * Marks documents / pages stuck in `processing` as `error` so users can retry.
 * Vercel may kill ingest/page workers at maxDuration without running catch;
 * listing documents and polling split-status are cheap places to reclaim
 * those orphans opportunistically.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Default: 10 minutes — well above normal ingest, below "forgotten forever". */
export const STUCK_PROCESSING_MS = 10 * 60 * 1000;

export async function reclaimStuckProcessingDocuments(
  db: AnyDb,
  tenantId: string,
  olderThanMs: number = STUCK_PROCESSING_MS,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const { data, error } = await db
    .from("documents")
    .update({
      status: "error",
      last_error: "Processing timed out or was interrupted. Retry ingest to continue.",
      last_error_step: "stuck_processing_reclaim",
    })
    .eq("tenant_id", tenantId)
    .eq("status", "processing")
    .lt("uploaded_at", cutoff)
    .select("id");
  if (error) {
    console.error("[reclaimStuckProcessingDocuments]", error);
    return 0;
  }
  return (data ?? []).length;
}

/**
 * Reclaims document_pages stuck in OCR (`status=processing`) or takeoff
 * (`takeoff_status=processing`). Page workers set these mid-flight and only
 * mark error in catch — a platform kill leaves pages stuck forever unless
 * something opportunistic reclaims them.
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

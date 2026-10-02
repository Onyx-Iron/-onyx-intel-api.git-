/**
 * Marks documents stuck in `processing` as `error` so users can retry.
 * Vercel may kill ingest at maxDuration without running catch/markError;
 * listing documents is a cheap place to reclaim those orphans opportunistically.
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

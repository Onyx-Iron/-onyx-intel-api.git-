/**
 * fire-and-forget ingest must not flip a document to error when another
 * run already owns it. 202 (queued split) is success. 409 is the in-flight
 * claim (`already_processing` / `concurrent_claim`) and the row should stay
 * in processing.
 */
export function shouldMarkIngestStartError(status: number): boolean {
  if (status >= 200 && status < 300) return false;
  if (status === 409) return false;
  return true;
}

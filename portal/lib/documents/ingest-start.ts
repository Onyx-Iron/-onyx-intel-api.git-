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

/** Retry the upload-complete call on a dropped connection or a server error. */
export function shouldRetryUploadComplete(status: number | null, attemptIndex: number, maxAttempts = 3): boolean {
  if (attemptIndex >= maxAttempts - 1) return false;
  if (status == null) return true;
  return status >= 500;
}

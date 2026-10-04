/** Same window ingest uses before it will start a second run. */
export const INGEST_CLAIM_WINDOW_MS = 270_000;

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

/**
 * A fresh `processing_started_at` only means a run is in flight when this
 * ingest already claimed the row. Upload complete used to write that
 * timestamp and then call ingest, so the first start looked like a duplicate
 * and came back `already_processing`.
 */
export function ingestStampIsLive(
  status: string | null | undefined,
  processingStartedAt: string | null | undefined,
  nowMs = Date.now(),
  windowMs = INGEST_CLAIM_WINDOW_MS,
): boolean {
  if (status !== "processing" || !processingStartedAt) return false;
  const started = new Date(processingStartedAt).getTime();
  if (!Number.isFinite(started)) return false;
  return nowMs - started < windowMs;
}

export function shouldSkipLiveIngest(stampIsLive: boolean, claimedByIngest: boolean): boolean {
  return stampIsLive && claimedByIngest;
}

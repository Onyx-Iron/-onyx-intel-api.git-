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

/** How long POST /ingest treats status=processing as an owner and skips. */
export const INGEST_IN_FLIGHT_MS = 270_000;

/**
 * True when POST /ingest will return 409 already_processing and do no work.
 * Callers that then fire ingest must not have just written this state
 * themselves — a fresh processing_started_at looks like a concurrent owner.
 */
export function ingestTreatsAsInFlight(
  status: string | null | undefined,
  processingStartedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (status !== "processing" || !processingStartedAt) return false;
  const started = Date.parse(processingStartedAt);
  if (!Number.isFinite(started)) return false;
  return nowMs - started < INGEST_IN_FLIGHT_MS;
}

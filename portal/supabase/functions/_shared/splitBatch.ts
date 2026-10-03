/**
 * Pure helpers for page-split batching + Documents list maintain polling.
 * Shared by the Deno page-split-worker and the Next.js portal (no runtime deps).
 */

/** Default pages per Edge invocation before self-chaining. */
export const DEFAULT_PAGE_BATCH = 75;

/** Default parallel page PDF uploads inside one batch. */
export const DEFAULT_UPLOAD_CONCURRENCY = 8;

/** Default max OCR+takeoff fan-out fetches in flight. */
export const DEFAULT_FANOUT_CONCURRENCY = 40;

/** Documents poll: run reclaim/finalize every N ticks. */
export const DEFAULT_MAINTAIN_EVERY_N_TICKS = 3;

export type PageBatchRange = {
  /** 1-based inclusive start */
  pageFrom: number;
  /** 1-based inclusive end of this batch */
  pageTo: number;
  /** 0-based indexes to upload in this batch */
  pageIndexes: number[];
  hasMore: boolean;
  nextPageFrom: number | null;
};

/**
 * Compute the page range for one split-worker invocation.
 * Caps at `pageBatch` pages starting at `pageFrom` (1-based).
 */
export function computePageBatchRange(
  pageFrom: number,
  pageCount: number,
  pageBatch: number = DEFAULT_PAGE_BATCH,
): PageBatchRange {
  const from = Math.max(1, Math.floor(pageFrom) || 1);
  const batch = Math.max(1, Math.floor(pageBatch) || DEFAULT_PAGE_BATCH);
  if (pageCount <= 0) {
    return { pageFrom: from, pageTo: from - 1, pageIndexes: [], hasMore: false, nextPageFrom: null };
  }
  if (from > pageCount) {
    return { pageFrom: from, pageTo: from - 1, pageIndexes: [], hasMore: false, nextPageFrom: null };
  }
  const pageTo = Math.min(pageCount, from + batch - 1);
  const pageIndexes = Array.from({ length: pageTo - from + 1 }, (_, k) => from - 1 + k);
  const hasMore = pageTo < pageCount;
  return {
    pageFrom: from,
    pageTo,
    pageIndexes,
    hasMore,
    nextPageFrom: hasMore ? pageTo + 1 : null,
  };
}

/** First batch clears prior pages; continuations append. */
export function shouldClearPages(pageFrom: number, clearPages?: boolean | null): boolean {
  if (clearPages != null) return Boolean(clearPages);
  return Math.max(1, Math.floor(pageFrom) || 1) <= 1;
}

/** Continuation batches always read the original from Storage. */
export function shouldReadOriginalFromStorage(
  pageFrom: number,
  hasDriveFileId: boolean,
): boolean {
  return !hasDriveFileId || Math.max(1, Math.floor(pageFrom) || 1) > 1;
}

/**
 * Parse maintain query flag for GET /api/documents.
 * Default: maintain when project-scoped (and param omitted).
 */
export function parseMaintainFlag(
  maintainParam: string | null,
  hasProjectId: boolean,
): boolean {
  if (maintainParam == null) return hasProjectId;
  return maintainParam === "1" || maintainParam === "true";
}

/**
 * Whether this poll tick should run reclaim/finalize.
 * Tick 1 always maintains; then every N ticks.
 */
export function shouldMaintainOnTick(
  tick: number,
  everyN: number = DEFAULT_MAINTAIN_EVERY_N_TICKS,
): boolean {
  if (tick <= 0) return false;
  const n = Math.max(1, Math.floor(everyN) || DEFAULT_MAINTAIN_EVERY_N_TICKS);
  return tick === 1 || tick % n === 0;
}

/** How many batches a deck needs at the given batch size. */
export function batchCountForPages(
  pageCount: number,
  pageBatch: number = DEFAULT_PAGE_BATCH,
): number {
  if (pageCount <= 0) return 0;
  const batch = Math.max(1, Math.floor(pageBatch) || DEFAULT_PAGE_BATCH);
  return Math.ceil(pageCount / batch);
}

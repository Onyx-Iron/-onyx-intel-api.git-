export type PageOutcome = "parsed" | "failed" | "missing" | "unread";

export interface LedgerPageInput {
  pageNumber: number;
  failed?: boolean;
  error?: string | null;
}

export interface PageLedgerEntry {
  pageNumber: number;
  outcome: PageOutcome;
  detail: string | null;
}

/**
 * Every expected page gets one outcome. A page that was never stored is
 * unread. A page named in the parse summary is missing. Failed rows stay
 * failed even if a later summary also lists them.
 */
export function buildPageLedger(args: {
  pageCount: number | null | undefined;
  pages: LedgerPageInput[];
  missingPageNumbers?: number[];
}): PageLedgerEntry[] {
  const expected = Number.isFinite(args.pageCount) ? Math.max(0, Math.min(args.pageCount ?? 0, 5000)) : 0;
  const byNumber = new Map<number, LedgerPageInput>();
  for (const page of args.pages) {
    if (Number.isInteger(page.pageNumber) && page.pageNumber > 0) byNumber.set(page.pageNumber, page);
  }
  const missing = new Set((args.missingPageNumbers ?? []).filter((n) => Number.isInteger(n) && n > 0));
  const highestStored = Math.max(0, ...byNumber.keys(), ...missing);
  const count = Math.min(Math.max(expected, highestStored), 5000);
  const entries: PageLedgerEntry[] = [];
  for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
    const row = byNumber.get(pageNumber);
    if (row?.failed) {
      entries.push({ pageNumber, outcome: "failed", detail: row.error ?? "This page failed to parse." });
    } else if (missing.has(pageNumber) && !row) {
      entries.push({ pageNumber, outcome: "missing", detail: "This page was not in the parse result." });
    } else if (row) {
      entries.push({ pageNumber, outcome: "parsed", detail: null });
    } else {
      entries.push({ pageNumber, outcome: "unread", detail: "This page has not been read yet." });
    }
  }
  return entries;
}

export function ledgerCounts(entries: PageLedgerEntry[]): Record<PageOutcome, number> {
  const counts: Record<PageOutcome, number> = { parsed: 0, failed: 0, missing: 0, unread: 0 };
  for (const entry of entries) counts[entry.outcome] += 1;
  return counts;
}

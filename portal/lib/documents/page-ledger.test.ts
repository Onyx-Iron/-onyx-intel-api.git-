import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPageLedger, ledgerCounts } from "./page-ledger.ts";

describe("page ledger", () => {
  it("marks stored, failed, missing, and unread pages without double-counting", () => {
    const entries = buildPageLedger({
      pageCount: 4,
      pages: [
        { pageNumber: 1 },
        { pageNumber: 3, failed: true, error: "timeout" },
      ],
      missingPageNumbers: [2, 3],
    });
    assert.deepEqual(
      entries.map((entry) => [entry.pageNumber, entry.outcome]),
      [
        [1, "parsed"],
        [2, "missing"],
        [3, "failed"],
        [4, "unread"],
      ],
    );
    assert.equal(entries[2]?.detail, "timeout");
    assert.deepEqual(ledgerCounts(entries), { parsed: 1, failed: 1, missing: 1, unread: 1 });
  });

  it("extends the ledger to a stored page past the declared count and caps at 5000", () => {
    const entries = buildPageLedger({
      pageCount: 1,
      pages: [{ pageNumber: 3 }],
    });
    assert.deepEqual(entries.map((entry) => entry.outcome), ["unread", "unread", "parsed"]);
    const capped = buildPageLedger({ pageCount: 9000, pages: [] });
    assert.equal(capped.length, 5000);
    assert.equal(capped[0]?.outcome, "unread");
  });
});

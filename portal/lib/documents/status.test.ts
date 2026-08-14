import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDocumentStatusSnapshot } from "./status.ts";

describe("buildDocumentStatusSnapshot", () => {
  it("sorts events newest-first so the UI sees the latest ingest state first", () => {
    const snapshot = buildDocumentStatusSnapshot(
      { id: "doc-1" },
      [
        {
          step: "split",
          status: "succeeded",
          worker: "page-split-worker",
          attempt_number: 1,
          error_code: null,
          error_message: null,
          started_at: "2026-08-04T10:00:00.000Z",
          completed_at: "2026-08-04T10:01:00.000Z",
        },
        {
          step: "indexing",
          status: "started",
          worker: "portal:documents-ingest",
          attempt_number: 1,
          error_code: null,
          error_message: null,
          started_at: "2026-08-04T10:05:00.000Z",
          completed_at: null,
        },
      ],
    );

    assert.equal(snapshot.events[0]?.step, "indexing");
    assert.equal(snapshot.events[1]?.step, "split");
  });
});

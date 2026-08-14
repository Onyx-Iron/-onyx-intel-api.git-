import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeProjectSyncSnapshot } from "./sync.ts";

describe("normalizeProjectSyncSnapshot", () => {
  it("normalizes bigint-like revisions and preserves cross-worker changes", () => {
    const snapshot = normalizeProjectSyncSnapshot({
      project_id: "9a959406-2eb3-4dd2-9c8b-4aba2b7573d0",
      revision: "42",
      updated_at: "2026-08-06T12:00:00.000Z",
      last_table: "document_pages",
      last_entity_id: "page-1",
      last_operation: "update",
      changes: [{
        id: "history-1",
        revision: "42",
        table_name: "document_pages",
        entity_id: "page-1",
        operation: "update",
        actor_user_id: "system",
        transaction_id: "9001",
        changed_at: "2026-08-06T12:00:00.000Z",
      }],
    });

    assert.equal(snapshot?.revision, 42);
    assert.equal(snapshot?.changes[0]?.table_name, "document_pages");
    assert.equal(snapshot?.changes[0]?.transaction_id, 9001);
  });

  it("rejects malformed or unsafe revisions", () => {
    assert.equal(normalizeProjectSyncSnapshot(null), null);
    assert.equal(normalizeProjectSyncSnapshot({ project_id: "p", revision: -1 }), null);
    assert.equal(normalizeProjectSyncSnapshot({ project_id: "p", revision: "not-a-number" }), null);
  });

  it("drops malformed change rows without dropping a valid snapshot", () => {
    const snapshot = normalizeProjectSyncSnapshot({
      project_id: "project-1",
      revision: 3,
      changes: [{ operation: "mystery" }],
    });

    assert.ok(snapshot);
    assert.deepEqual(snapshot.changes, []);
  });
});

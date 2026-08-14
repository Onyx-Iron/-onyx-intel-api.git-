import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateImportCommand } from "./import-command";

describe("approved takeoff import command", () => {
  it("requires an exact confirmed preview and stable idempotency key", () => {
    assert.deepEqual(validateImportCommand({ previewStatus: "confirmed", previewProjectId: "p1", projectId: "p1", idempotencyKey: "cmd-1" }), { valid: true });
    assert.equal(validateImportCommand({ previewStatus: "pending", previewProjectId: "p1", projectId: "p1", idempotencyKey: "cmd-1" }).reason, "preview_not_confirmed");
    assert.equal(validateImportCommand({ previewStatus: "confirmed", previewProjectId: "p2", projectId: "p1", idempotencyKey: "cmd-1" }).reason, "project_mismatch");
    assert.equal(validateImportCommand({ previewStatus: "confirmed", previewProjectId: "p1", projectId: "p1", idempotencyKey: "" }).reason, "missing_idempotency_key");
  });
});

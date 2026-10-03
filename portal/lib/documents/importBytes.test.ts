import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDocumentRevisionMeta } from "./revisions.ts";

/**
 * Gmail/cloud import meta contract — asserts the shared ingest path stamps
 * source + gmail ids the way import-attachment / import-cloud require.
 */
describe("importPlanBytes meta contract", () => {
  it("stamps gmail source and attachment ids into document meta", () => {
    const meta = buildDocumentRevisionMeta("Plan.pdf", {
      source: "gmail",
      storage: "supabase",
      storage_path: "t/p/plan.pdf",
      size: 12,
      content_type: "application/pdf",
      gmail_message_id: "msg-1",
      gmail_attachment_id: "att-1",
    });
    assert.equal(meta.source, "gmail");
    assert.equal(meta.gmail_message_id, "msg-1");
    assert.equal(meta.gmail_attachment_id, "att-1");
  });

  it("stamps dropbox cloud_provider for import-cloud", () => {
    const meta = buildDocumentRevisionMeta("Sheet.dwg", {
      source: "dropbox",
      cloud_provider: "dropbox",
      cloud_file_id: "id:abc",
    });
    assert.equal(meta.source, "dropbox");
    assert.equal(meta.cloud_provider, "dropbox");
  });
});

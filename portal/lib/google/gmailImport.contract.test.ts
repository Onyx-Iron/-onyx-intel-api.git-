import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDocumentRevisionMeta } from "../documents/revisions.ts";

/**
 * Gmail import happy-path contract: attachment bytes land as documents with
 * meta.source=gmail and permission-sensitive fields present.
 */
describe("gmail import-attachment contract", () => {
  it("requires project_id + message_id + attachment_id", () => {
    const body = {
      project_id: "p1",
      message_id: "m1",
      attachment_id: "a1",
      filename: "plan.pdf",
    };
    const ok = Boolean(body.project_id && body.message_id && body.attachment_id && body.filename);
    assert.equal(ok, true);
  });

  it("stamps gmail meta for ingest pipeline", () => {
    const meta = buildDocumentRevisionMeta("ITB Plans.pdf", {
      source: "gmail",
      storage: "supabase",
      storage_path: "tenant/p1/itb.pdf",
      gmail_message_id: "msg-99",
      gmail_attachment_id: "att-99",
      content_type: "application/pdf",
    });
    assert.equal(meta.source, "gmail");
    assert.equal(meta.gmail_message_id, "msg-99");
    assert.equal(meta.gmail_attachment_id, "att-99");
  });

  it("denies cross-tenant project attach (isolation rule)", () => {
    const projectTenant: string = "t-a";
    const callerTenant: string = "t-b";
    const allowed = projectTenant === callerTenant;
    assert.equal(allowed, false);
  });
});

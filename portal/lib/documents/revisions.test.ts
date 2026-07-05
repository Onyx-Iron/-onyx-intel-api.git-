import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDocumentRevisionMeta,
  buildDocumentRevisionSummaries,
  parseDocumentRevision,
} from "./revisions.ts";

describe("document revision metadata", () => {
  it("infers revision and family from file names", () => {
    const parsed = parseDocumentRevision("Level 1 Floor Plan Rev 3.pdf");
    assert.equal(parsed.familyKey, "level-1-floor-plan");
    assert.equal(parsed.title, "Level 1 Floor Plan");
    assert.equal(parsed.revisionToken, "3");
    assert.equal(parsed.revisionRank, 3);
  });

  it("builds consistent metadata payloads", () => {
    const meta = buildDocumentRevisionMeta("Site Utility Plan R2.dwg", {
      source: "direct_upload",
      storage_path: "tenant/project/file",
      size: 1200,
      content_type: "application/acad",
    });

    assert.equal(meta.family_key, "site-utility-plan");
    assert.equal(meta.revision_token, "2");
    assert.equal(meta.plan_set_label, "Site Utility Plan - Rev 2");
    assert.equal(meta.storage_path, "tenant/project/file");
  });

  it("summarizes latest revisions and superseded docs", () => {
    const summaries = buildDocumentRevisionSummaries([
      {
        id: "doc-1",
        file_name: "Floor Plan Rev 1.pdf",
        uploaded_at: "2026-06-28T10:00:00.000Z",
        meta: buildDocumentRevisionMeta("Floor Plan Rev 1.pdf", { source: "direct_upload", storage_path: "a" }),
      },
      {
        id: "doc-2",
        file_name: "Floor Plan Rev 2.pdf",
        uploaded_at: "2026-06-28T11:00:00.000Z",
        meta: buildDocumentRevisionMeta("Floor Plan Rev 2.pdf", { source: "direct_upload", storage_path: "b" }),
      },
    ]);

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].latest_document_id, "doc-2");
    assert.equal(summaries[0].latest_revision, "2");
    assert.equal(summaries[0].superseded_count, 1);
  });
});

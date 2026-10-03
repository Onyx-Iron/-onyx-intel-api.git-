import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fanOutSheetJobs, sheetFanoutEndpoints } from "./sheet-fanout.ts";

describe("sheet fan-out", () => {
  it("targets the page processor and the takeoff worker", () => {
    const urls = sheetFanoutEndpoints("https://example.supabase.co/");
    assert.equal(urls.processorUrl, "https://example.supabase.co/functions/v1/page-processor");
    assert.equal(urls.takeoffUrl, "https://example.supabase.co/functions/v1/page-takeoff-worker");
  });

  it("posts each new sheet to both workers and counts HTTP failures", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      return new Response("no", { status: url.includes("page-takeoff") ? 503 : 200 });
    }) as typeof fetch;
    const result = await fanOutSheetJobs({
      jobs: [{
        page_id: "page-1",
        document_id: "doc-1",
        tenant_id: "tenant-1",
        project_id: "project-1",
        page_number: 1,
        storage_path: "pages/doc-1/page-1.pdf",
      }],
      supabaseUrl: "https://example.supabase.co",
      serviceKey: "service-key",
      fetchImpl,
    });
    assert.equal(seen.length, 2);
    assert.equal(result.attempted, 2);
    assert.equal(result.failures, 1);
  });
});

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { invokePageSplitWorker } from "./pageSplitWorker";

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const ORIGINAL_FETCH = globalThis.fetch;

describe("invokePageSplitWorker", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = ORIGINAL_ENV.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_KEY = ORIGINAL_ENV.SUPABASE_SERVICE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_ENV.SUPABASE_SERVICE_ROLE_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("throws a descriptive error when the worker responds non-OK", async () => {
    globalThis.fetch = (async () => new Response("worker boot failed", { status: 503 })) as typeof fetch;

    await assert.rejects(
      invokePageSplitWorker({
        document_id: "doc-1",
        tenant_id: "tenant-1",
        project_id: "project-1",
        original_path: "originals/doc-1.pdf",
        is_local_upload: true,
        user_id: "user-1",
      }),
      /page-split-worker 503: worker boot failed/,
    );
  });

  it("requires Supabase worker configuration", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";

    await assert.rejects(
      invokePageSplitWorker({
        document_id: "doc-1",
        tenant_id: "tenant-1",
        project_id: "project-1",
        original_path: "originals/doc-1.pdf",
        is_local_upload: true,
        user_id: "user-1",
      }),
      /SUPABASE_URL and SUPABASE_SERVICE_KEY must be set/,
    );
  });
});

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

const basePayload = {
  document_id: "doc-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  original_path: "originals/doc-1.pdf",
  is_local_upload: true as const,
  user_id: "user-1",
};

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

  it("retries transient 503 responses before failing", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("worker boot failed", { status: 503 });
    }) as typeof fetch;

    await assert.rejects(
      invokePageSplitWorker(basePayload),
      /page-split-worker 503: worker boot failed/,
    );
    assert.equal(calls, 3);
  });

  it("succeeds when a retry eventually returns OK", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 2) return new Response("temporarily unavailable", { status: 502 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    await invokePageSplitWorker(basePayload);
    assert.equal(calls, 2);
  });

  it("does not retry non-retryable 400 responses", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    }) as typeof fetch;

    await assert.rejects(
      invokePageSplitWorker(basePayload),
      /page-split-worker 400: bad request/,
    );
    assert.equal(calls, 1);
  });

  it("requires Supabase worker configuration", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";

    await assert.rejects(
      invokePageSplitWorker(basePayload),
      /SUPABASE_URL and SUPABASE_SERVICE_KEY must be set/,
    );
  });
});

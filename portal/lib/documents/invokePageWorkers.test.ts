import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { invokePageProcessor, invokePageTakeoffWorker, type PageWorkerPayload } from "./invokePageWorkers.ts";

const ORIGINAL_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const ORIGINAL_FETCH = globalThis.fetch;

const payload: PageWorkerPayload = {
  page_id: "page-1",
  document_id: "doc-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  page_number: 4,
  storage_path: "pages/doc-1/page-4.pdf",
};

describe("invokePageWorkers", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
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

  it("posts the page payload to the OCR and takeoff functions", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await invokePageProcessor(payload);
    await invokePageTakeoffWorker(payload);

    assert.equal(calls[0]?.url, "https://example.supabase.co/functions/v1/page-processor");
    assert.equal(calls[1]?.url, "https://example.supabase.co/functions/v1/page-takeoff-worker");
    assert.equal(new Headers(calls[0]?.init?.headers).get("Authorization"), "Bearer service-key");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), payload);
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), payload);
  });

  it("uses the service role key when the service key is unset", async () => {
    process.env.SUPABASE_SERVICE_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "role-key";
    let authorization = "";
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await invokePageProcessor(payload);
    assert.equal(authorization, "Bearer role-key");
  });

  it("retries a 429 and then accepts success", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 2) return new Response("rate limited", { status: 429 });
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await invokePageTakeoffWorker(payload);
    assert.equal(calls, 2);
  });

  it("retries a dropped connection before succeeding", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 2) throw new Error("socket hang up");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await invokePageProcessor(payload);
    assert.equal(calls, 2);
  });

  it("stops after three retryable 503 responses", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("worker boot failed", { status: 503 });
    }) as typeof fetch;

    await assert.rejects(
      invokePageProcessor(payload),
      /page-processor 503: worker boot failed/,
    );
    assert.equal(calls, 3);
  });

  it("does not retry a 400 and trims the error body", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(`bad request ${"x".repeat(400)}`, { status: 400 });
    }) as typeof fetch;

    await assert.rejects(invokePageProcessor(payload), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /^page-processor 400: bad request /);
      assert.equal(err.message.length, "page-processor 400: ".length + 300);
      return true;
    });
    assert.equal(calls, 1);
  });

  it("requires Supabase worker configuration", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.SUPABASE_URL = "";
    process.env.SUPABASE_SERVICE_KEY = "";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await assert.rejects(
      invokePageProcessor(payload),
      /SUPABASE_URL and SUPABASE_SERVICE_KEY must be set/,
    );
    assert.equal(calls, 0);
  });
});

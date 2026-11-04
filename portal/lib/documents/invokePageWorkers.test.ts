import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { invokePageProcessor, invokePageTakeoffWorker, type PageWorkerPayload } from "./invokePageWorkers.ts";

const payload: PageWorkerPayload = {
  page_id: "page-1",
  document_id: "doc-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  page_number: 3,
  storage_path: "docs/page-1.pdf",
};

const savedEnv = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  altUrl: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_KEY,
  role: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

function useFakeSupabase(): void {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
  delete process.env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_KEY = "test-service-key";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function restoreEnv(): void {
  restore("NEXT_PUBLIC_SUPABASE_URL", savedEnv.url);
  restore("SUPABASE_URL", savedEnv.altUrl);
  restore("SUPABASE_SERVICE_KEY", savedEnv.key);
  restore("SUPABASE_SERVICE_ROLE_KEY", savedEnv.role);
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  mock.restoreAll();
  restoreEnv();
});

describe("page worker invoke", () => {
  it("posts the page payload once when the worker accepts it", async () => {
    useFakeSupabase();
    const calls: Array<{ url: string; authorization: string; body: string }> = [];
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(input),
        authorization: headers.get("authorization") ?? "",
        body: String(init?.body ?? ""),
      });
      return new Response(null, { status: 200 });
    });

    await invokePageTakeoffWorker(payload, { wait: async () => {} });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/page-takeoff-worker");
    assert.equal(calls[0].authorization, "Bearer test-service-key");
    assert.deepEqual(JSON.parse(calls[0].body), payload);
  });

  it("does not retry a client error", async () => {
    useFakeSupabase();
    let calls = 0;
    const waits: number[] = [];
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return new Response("bad page", { status: 400 });
    });

    await assert.rejects(
      () => invokePageProcessor(payload, { wait: async (ms) => { waits.push(ms); } }),
      /page-processor 400: bad page/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  it("retries a server error with backoff, then succeeds", async () => {
    useFakeSupabase();
    let calls = 0;
    const waits: number[] = [];
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(null, { status: 200 });
    });

    await invokePageProcessor(payload, { wait: async (ms) => { waits.push(ms); } });
    assert.equal(calls, 2);
    assert.deepEqual(waits, [500]);
  });

  it("retries a network failure and a 429, then surfaces a trimmed error", async () => {
    useFakeSupabase();
    let calls = 0;
    const waits: number[] = [];
    const detail = "x".repeat(400);
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket hangup");
      return new Response(detail, { status: 429 });
    });

    await assert.rejects(
      () => invokePageProcessor(payload, { wait: async (ms) => { waits.push(ms); } }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, `page-processor 429: ${"x".repeat(300)}`);
        return true;
      },
    );
    assert.equal(calls, 3);
    assert.deepEqual(waits, [500, 1000]);
  });

  it("refuses to call the worker when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    });

    await assert.rejects(
      () => invokePageProcessor(payload, { wait: async () => {} }),
      /SUPABASE_URL and SUPABASE_SERVICE_KEY must be set/,
    );
    assert.equal(calls, 0);
  });
});

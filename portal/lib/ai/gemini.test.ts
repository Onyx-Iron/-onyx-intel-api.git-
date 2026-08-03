import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { fetchGemini } from "./gemini";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("fetchGemini", () => {
  it("retries transient 503 responses and eventually succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) return new Response("temporary outage", { status: 503 });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const res = await fetchGemini("https://example.test/gemini", { method: "POST" }, { maxAttempts: 3, timeoutMs: 5_000, label: "Gemini test" });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);
  });

  it("aborts hung requests on timeout", async () => {
    globalThis.fetch = ((_: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timed out")));
    })) as typeof fetch;

    await assert.rejects(
      fetchGemini("https://example.test/gemini", { method: "POST" }, { maxAttempts: 1, timeoutMs: 10, label: "Gemini hung request" }),
      /timed out/,
    );
  });
});

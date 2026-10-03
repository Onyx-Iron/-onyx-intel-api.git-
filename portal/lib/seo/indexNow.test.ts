import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { pingIndexNow } from "./indexNow.ts";

describe("pingIndexNow", () => {
  it("rejects empty url list", async () => {
    const r = await pingIndexNow({ host: "example.com", key: "k", urlList: [] });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  it("posts expected IndexNow payload shape", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? "") });
      return new Response(null, { status: 200 });
    });

    const r = await pingIndexNow({
      host: "https://acme.example/",
      key: "abc123",
      keyLocation: "https://acme.example/abc123.txt",
      urlList: ["https://acme.example/projects/1"],
    });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /indexnow\.org/);
    const payload = JSON.parse(calls[0].body) as {
      host: string;
      key: string;
      keyLocation: string;
      urlList: string[];
    };
    assert.equal(payload.host, "acme.example");
    assert.equal(payload.key, "abc123");
    assert.equal(payload.keyLocation, "https://acme.example/abc123.txt");
    assert.deepEqual(payload.urlList, ["https://acme.example/projects/1"]);
  });
});

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { pageSplitPipelineHealthy } from "./pageSplitHealth";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});

describe("page split pipeline health", () => {
  it("fails closed when worker configuration is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(await pageSplitPipelineHealthy(async () => new Response("ok") as never), false);
  });

  it("requires both functions to boot and rejects a BOOT_ERROR", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    let calls = 0;
    const fetcher = async () => ++calls === 1 ? new Response("ok", { status: 200 }) : new Response("BOOT_ERROR", { status: 503 });
    assert.equal(await pageSplitPipelineHealthy(fetcher as typeof fetch), false);
    assert.equal(calls, 2);
  });
});

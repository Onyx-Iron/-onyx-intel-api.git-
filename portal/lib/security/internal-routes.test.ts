import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const portalRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("internal cron routes", () => {
  it("exempts every scheduled internal path from Clerk", () => {
    const vercel = JSON.parse(readFileSync(join(portalRoot, "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string }>;
    };
    const proxy = readFileSync(join(portalRoot, "proxy.ts"), "utf8");
    const internal = (vercel.crons ?? [])
      .map((cron) => cron.path)
      .filter((path) => path.startsWith("/api/internal/"));

    assert.ok(internal.includes("/api/internal/outbox/process"));
    assert.ok(internal.includes("/api/internal/sheets/process"));

    const missing = internal.filter((path) => !proxy.includes(`"${path}"`));
    assert.deepEqual(missing, []);
  });

  it("fail closed on the sheet worker secret before using the service role", () => {
    const source = readFileSync(
      join(portalRoot, "app/api/internal/sheets/process/route.ts"),
      "utf8",
    );

    const secretCheck = source.indexOf("if (!authorize(req))");
    const serviceClient = source.indexOf("await createServiceClient()");
    assert.ok(secretCheck >= 0, "sheet worker must authorize the caller");
    assert.ok(serviceClient > secretCheck, "auth must run before the service-role client");

    assert.match(source, /INTERNAL_WORKER_SECRET/);
    assert.match(source, /CRON_SECRET/);
    assert.match(source, /x-worker-secret/);
    assert.match(source, /authorization/);
    assert.match(source, /Bearer /);
    assert.match(source, /is not configured/);
    assert.match(source, /Unauthorized/);
    assert.match(source, /batch_size <= 100/);
    assert.match(source, /q <= 100/);
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PLATFORM_ADMIN_ROUTES = [
  "app/api/admin/comp-access/route.ts",
  "app/api/cost-catalog/ingest/bls/route.ts",
  "app/api/cost-catalog/ingest/dot/route.ts",
  "app/api/cost-catalog/ingest/oce/route.ts",
];

describe("platform administrator policy", () => {
  for (const file of PLATFORM_ADMIN_ROUTES) {
    it(`${file} uses the centralized platform administrator gate`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("requirePlatformAdmin("));
      assert.ok(source.includes("PlatformAdminError"));
      assert.ok(!source.includes("ADMIN_EMAIL"));
      assert.ok(!source.includes("justinatteberry@"));
    });
  }

  it("loads the allowlist from server-only configuration and fails closed", () => {
    const source = readFileSync(resolve(process.cwd(), "lib/auth/platform-admin.ts"), "utf8");
    assert.ok(source.includes('import "server-only"'));
    assert.ok(source.includes("process.env.ONYX_PLATFORM_ADMIN_EMAILS"));
    assert.ok(source.includes("Platform administration is not configured"));
    assert.ok(!source.includes("justinatteberry@"));
  });
});

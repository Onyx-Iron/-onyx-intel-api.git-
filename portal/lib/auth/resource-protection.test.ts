import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP_ROOT = join(process.cwd(), "app");
const PUBLIC_API_ROUTES = new Set([
  "api/procurement/bids/route.ts",
  "api/public/procurement-request/[id]/route.ts",
  "api/version/route.ts",
]);

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("Clerk resource-based protection", () => {
  it("protects every non-public API route at the resource boundary", () => {
    const unprotected = filesBelow(join(APP_ROOT, "api"))
      .filter((path) => path.endsWith("route.ts"))
      .filter((path) => !PUBLIC_API_ROUTES.has(relative(APP_ROOT, path).replaceAll("\\", "/")))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return !/@clerk\/nextjs\/server|requireGoogleToken|INTERNAL_WORKER_SECRET|CRON_SECRET|verifyWebhookSignature/.test(source);
      });
    assert.deepEqual(unprotected, []);
  });

  it("protects dashboard, admin, and onboarding pages without deprecated path matching", () => {
    for (const path of ["dashboard/layout.tsx", "admin/layout.tsx", "onboarding/layout.tsx"]) {
      assert.equal(existsSync(join(APP_ROOT, path)), true, `${path} is required`);
      assert.match(readFileSync(join(APP_ROOT, path), "utf8"), /@clerk\/nextjs\/server/);
    }
    assert.doesNotMatch(readFileSync(join(process.cwd(), "proxy.ts"), "utf8"), /createRouteMatcher/);
  });
});

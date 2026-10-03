import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const portalRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = join(portalRoot, "app/api");

const ALLOWLIST = new Set([
  "cost-catalog/ingest/dot/route.ts",
  "cost-catalog/ingest/bls/route.ts",
  "cost-catalog/ingest/oce/route.ts",
  "public/procurement-request/[id]/route.ts",
  // Cross-tenant workers. Auth is INTERNAL_WORKER_SECRET / CRON_SECRET,
  // not a tenant predicate. internal-routes.test.ts locks that check.
  "internal/outbox/process/route.ts",
  "internal/sheets/process/route.ts",
]);

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (entry === "route.ts") files.push(full);
  }
  return files;
}

describe("service-role routes filter by tenant", () => {
  it("mentions tenant_id unless the route is an existing exception", () => {
    const missing: string[] = [];
    for (const file of walk(apiRoot)) {
      const rel = relative(apiRoot, file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const usesServiceRole = source.includes("createServiceClient") || source.includes("getServiceDb");
      const mentionsTenant = source.includes("tenant_id") || source.includes("tenantId");
      if (usesServiceRole && !mentionsTenant && !ALLOWLIST.has(rel)) missing.push(rel);
    }
    assert.deepEqual(missing, []);
  });
});

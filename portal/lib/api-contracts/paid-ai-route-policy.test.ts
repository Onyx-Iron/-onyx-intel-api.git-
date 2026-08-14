import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const PAID_AI_ROUTES = [
  "app/api/ai/chat/route.ts",
  "app/api/ai/risk-digest/route.ts",
  "app/api/agents/daily-log-assistant/route.ts",
  "app/api/agents/risk-scout/route.ts",
  "app/api/contacts/parse/route.ts",
  "app/api/documents/[id]/ingest/route.ts",
  "app/api/documents/ask/route.ts",
  "app/api/generated-docs/route.ts",
  "app/api/parse/document/route.ts",
  "app/api/reports/route.ts",
  "app/api/status-report/route.ts",
  "app/api/takeoff/canvas/vision-extract/route.ts",
  "app/api/takeoff/extract/route.ts",
  "app/api/weekly-logs/[id]/generate/route.ts",
];

describe("paid AI route policy", () => {
  for (const file of PAID_AI_ROUTES) {
    it(`${file} consumes a database-backed rate-limit allowance`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("checkAiRateLimit("));
      assert.ok(source.includes("status: 429"));
      assert.ok(source.includes('"Retry-After"'));
    });
  }

  it("uses an atomic database function and fails closed", () => {
    const helper = readFileSync(resolve(process.cwd(), "lib/ai/rate-limit.ts"), "utf8");
    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260814_atomic_ai_rate_limits.sql"),
      "utf8",
    );
    assert.ok(helper.includes('rpc("consume_ai_rate_limit"'));
    assert.ok(helper.includes("if (error || data !== true)"));
    assert.ok(migration.includes("pg_advisory_xact_lock"));
    assert.ok(migration.includes("REVOKE ALL ON FUNCTION"));
    assert.ok(migration.includes("FROM anon"));
    assert.ok(migration.includes("FROM authenticated"));
    assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION"));
  });
});

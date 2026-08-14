import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("billing webhook delivery policy", () => {
  const route = readFileSync(resolve(process.cwd(), "app/api/billing/webhook/route.ts"), "utf8");
  const migration = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20260814_billing_webhook_events.sql"),
    "utf8",
  );

  it("durably claims events and only acknowledges completed processing", () => {
    assert.ok(route.includes("claimEvent("));
    assert.ok(route.includes("finishEvent(eventId, \"processed\")"));
    assert.ok(route.includes("finishEvent(eventId, \"failed\""));
    assert.ok(route.includes("Webhook processing failed"));
    assert.ok(route.includes("status: 500"));
    assert.ok(!route.includes("Return 200 anyway"));
  });

  it("keeps the idempotency ledger inaccessible to browser roles", () => {
    assert.ok(migration.includes("event_id text PRIMARY KEY"));
    assert.ok(migration.includes("FORCE ROW LEVEL SECURITY"));
    assert.ok(migration.includes("FROM anon"));
    assert.ok(migration.includes("FROM authenticated"));
    assert.ok(migration.includes("TO service_role"));
  });
});

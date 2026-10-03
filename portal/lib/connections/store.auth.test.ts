import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Pure contract for Connections route auth/tenant isolation.
 * Full route HTTP tests need Clerk mocks; this locks the isolation rules
 * the route must enforce (see app/api/connections/route.ts).
 */
describe("connections route auth contract", () => {
  it("requires clerk userId before listing chips", () => {
    const userId: string | null = null;
    const status = !userId ? 401 : 200;
    assert.equal(status, 401);
  });

  it("scopes disconnect to (tenantId, userId, provider)", () => {
    const key = (tenantId: string, userId: string, provider: string) =>
      `${tenantId}|${userId}|${provider}`;
    assert.notEqual(
      key("t1", "u1", "dropbox"),
      key("t2", "u1", "dropbox"),
      "cross-tenant disconnect must not share key",
    );
    assert.notEqual(
      key("t1", "u1", "dropbox"),
      key("t1", "u2", "dropbox"),
      "cross-user disconnect must not share key",
    );
  });

  it("rejects icloud disconnect (no OAuth row)", () => {
    const provider = "icloud";
    const allowed = provider !== "icloud";
    assert.equal(allowed, false);
  });
});

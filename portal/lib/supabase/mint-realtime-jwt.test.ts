import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mintRealtimeJwt, canMintRealtimeJwt } from "./mint-realtime-jwt";

describe("mintRealtimeJwt", () => {
  it("reports whether SUPABASE_JWT_SECRET is configured", () => {
    assert.equal(typeof canMintRealtimeJwt(), "boolean");
  });

  it("mints a verifiable HS256 JWT with org_id when secret is set", () => {
    const previous = process.env.SUPABASE_JWT_SECRET;
    process.env.SUPABASE_JWT_SECRET = "unit-test-secret";
    try {
      const token = mintRealtimeJwt({ sub: "user_123", orgId: "org_abc", expiresInSeconds: 120 });
      const [headerB64, payloadB64, sig] = token.split(".");
      assert.ok(headerB64 && payloadB64 && sig);
      const expected = createHmac("sha256", "unit-test-secret")
        .update(`${headerB64}.${payloadB64}`)
        .digest("base64url");
      assert.equal(sig, expected);
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
        role: string;
        org_id: string;
        sub: string;
      };
      assert.equal(payload.role, "authenticated");
      assert.equal(payload.org_id, "org_abc");
      assert.equal(payload.sub, "user_123");
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = previous;
    }
  });
});

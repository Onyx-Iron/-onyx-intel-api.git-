import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serviceRoleAuthorized } from "../../supabase/functions/_shared/service-role-auth.ts";

const SERVICE_KEY = "service-role-key";

describe("serviceRoleAuthorized", () => {
  it("accepts the service-role bearer the portal and cron already send", () => {
    assert.equal(serviceRoleAuthorized(`Bearer ${SERVICE_KEY}`, SERVICE_KEY), true);
  });

  it("rejects the publishable anon key", () => {
    assert.equal(serviceRoleAuthorized("Bearer anon-key", SERVICE_KEY), false);
  });

  it("rejects a missing or non-bearer header", () => {
    assert.equal(serviceRoleAuthorized(null, SERVICE_KEY), false);
    assert.equal(serviceRoleAuthorized(SERVICE_KEY, SERVICE_KEY), false);
  });

  it("fails closed when the service role key is not configured", () => {
    assert.equal(serviceRoleAuthorized(`Bearer ${SERVICE_KEY}`, ""), false);
  });
});

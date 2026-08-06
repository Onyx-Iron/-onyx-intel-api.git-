import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { pythonApiHeaders, pythonApiSecret } from "./python-api";

const originalApiSecret = process.env.ONYX_API_SECRET;
const originalAdminSecret = process.env.RATE_LIMIT_ADMIN_SECRET;

afterEach(() => {
  if (originalApiSecret === undefined) delete process.env.ONYX_API_SECRET;
  else process.env.ONYX_API_SECRET = originalApiSecret;

  if (originalAdminSecret === undefined) delete process.env.RATE_LIMIT_ADMIN_SECRET;
  else process.env.RATE_LIMIT_ADMIN_SECRET = originalAdminSecret;
});

test("uses the canonical Railway secret for every user", () => {
  process.env.ONYX_API_SECRET = "canonical-secret";
  process.env.RATE_LIMIT_ADMIN_SECRET = "stale-admin-secret";

  assert.equal(pythonApiSecret("justinatteberry@onyx-iron.com"), "canonical-secret");
  assert.equal(pythonApiSecret("estimator@example.com"), "canonical-secret");
  assert.equal(
    pythonApiHeaders({ email: "justinatteberry@onyx-iron.com" })["X-Onyx-Secret"],
    "canonical-secret",
  );
});

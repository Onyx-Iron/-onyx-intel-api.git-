import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("verify-test-schema launcher", () => {
  it("runs the TypeScript verifier successfully when integration tests are disabled", () => {
    const portalRoot = resolve(__dirname, "..");
    const result = spawnSync(process.execPath, [resolve(portalRoot, "scripts", "verify-test-schema.mjs")], {
      cwd: portalRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ALLOW_INTEGRATION_TESTS: "false",
        TEST_SUPABASE_URL: "",
        TEST_SUPABASE_SERVICE_ROLE_KEY: "",
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /schema check skipped/i);
  });
});

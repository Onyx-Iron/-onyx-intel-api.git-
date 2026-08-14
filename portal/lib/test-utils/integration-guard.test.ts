import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertIntegrationTestEnvReady, type IntegrationTestEnv } from "./integration-guard";

describe("integration release gate", () => {
  it("fails closed when a required integration environment would otherwise skip", () => {
    const missing: IntegrationTestEnv = { ready: false, skipReason: "test credentials missing" };
    assert.throws(() => assertIntegrationTestEnvReady(missing, true), /test credentials missing/i);
  });

  it("allows local optional integration runs to self-skip", () => {
    const missing: IntegrationTestEnv = { ready: false, skipReason: "not opted in" };
    assert.equal(assertIntegrationTestEnvReady(missing, false), false);
  });

  it("returns true for an isolated ready environment", () => {
    assert.equal(assertIntegrationTestEnvReady({ ready: true, projectRef: "isolated" }, true), true);
  });
});

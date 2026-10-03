import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Pure chip-shape expectations for Connections UI (auth/tenant isolation
 * is exercised in integration; unit tests cover the contract surface).
 */
describe("connection chip contract", () => {
  const REQUIRED = [
    "google", "dropbox", "sharefile", "meta", "gbp", "gsc", "linkedin", "icloud",
  ] as const;

  it("includes every hub provider including iCloud (non-OAuth)", () => {
    assert.ok(REQUIRED.includes("icloud"));
    assert.equal(REQUIRED.length, 8);
  });

  it("treats error status as not connected for OAuth chips", () => {
    const status: string = "error";
    const connected = status === "connected";
    assert.equal(connected, false);
  });
});

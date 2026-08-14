import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { hasHeaderInjection, isValidEmailList, requiresExplicitConfirmation } from "./external-action";

describe("external Google action boundaries", () => {
  it("requires an exact boolean confirmation", () => {
    assert.equal(requiresExplicitConfirmation(true), false);
    for (const value of [false, undefined, null, "true", 1]) {
      assert.equal(requiresExplicitConfirmation(value), true);
    }
  });

  it("rejects email header injection and malformed recipient lists", () => {
    assert.equal(hasHeaderInjection("Subject\r\nBcc: attacker@example.com"), true);
    assert.equal(isValidEmailList("buyer@example.com,pm@example.org"), true);
    assert.equal(isValidEmailList("buyer@example.com\r\nBcc: attacker@example.com"), false);
    assert.equal(isValidEmailList("not-an-email"), false);
  });

  for (const file of [
    "app/api/google/gmail/send/route.ts",
    "app/api/google/docs/create/route.ts",
    "app/api/google/calendar/event/route.ts",
  ]) {
    it(`${file} confirms and audits its external write`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("requiresExplicitConfirmation("));
      assert.ok(source.includes("CONFIRMATION_REQUIRED"));
      assert.ok(source.includes("auditInsert("));
    });
  }
});

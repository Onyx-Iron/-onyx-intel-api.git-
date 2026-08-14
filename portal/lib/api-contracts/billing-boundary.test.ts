import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

describe("billing state authority", () => {
  it("never accepts subscription status from the company profile API", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/companies/route.ts"), "utf8");
    const patchHandler = source.slice(source.indexOf("export async function PATCH"));
    assert.doesNotMatch(patchHandler, /body\.subscription_status/);
    assert.ok(patchHandler.includes('"admin", "write"'));
  });
});

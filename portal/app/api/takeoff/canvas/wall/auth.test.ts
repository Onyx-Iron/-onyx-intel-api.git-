import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { canPerform } from "../../../../../lib/project-controls/permissions.ts";

describe("canvas wall writes", () => {
  it("denies a client view any field write", () => {
    assert.equal(canPerform("ClientView", "field", "write"), false);
    assert.equal(canPerform("Estimator", "field", "write"), true);
  });

  it("checks field write before a wall recipe is mirrored into takeoff", () => {
    const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
    const post = source.slice(source.indexOf("export async function POST"));
    const guard = post.indexOf('requirePermission(tenantId, userId, "field", "write")');
    const mirror = post.indexOf("mirrorCivilItemsToTakeoff");
    assert.ok(guard > 0, "POST must require field write");
    assert.ok(mirror > guard, "permission check must run before the takeoff mirror");
  });
});

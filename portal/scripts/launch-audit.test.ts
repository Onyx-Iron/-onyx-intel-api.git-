import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";

describe("launch billing configuration audit", () => {
  let emptyWorkspace = "";
  let output = "";

  before(() => {
    emptyWorkspace = mkdtempSync(join(tmpdir(), "onyx-launch-audit-"));
    const result = spawnSync(process.execPath, [resolve(process.cwd(), "scripts/launch-audit.mjs")], {
      cwd: emptyWorkspace,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    output = `${result.stdout}\n${result.stderr}`;
  });

  after(() => rmSync(emptyWorkspace, { recursive: true, force: true }));

  it("blocks launch when any sellable Paddle price is missing", () => {
    for (const key of [
      "PADDLE_PRICE_SOLO_MONTHLY",
      "PADDLE_PRICE_SOLO_YEARLY",
      "PADDLE_PRICE_CREW_MONTHLY",
      "PADDLE_PRICE_CREW_YEARLY",
      "PADDLE_PRICE_BUSINESS_MONTHLY",
      "PADDLE_PRICE_BUSINESS_YEARLY",
    ]) {
      assert.match(output, new RegExp(`${key}: missing`));
    }
    assert.match(output, /Paddle product prices are incomplete/);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("GIS token client", () => {
  it("forces include_granted_scopes false in the shared factory", () => {
    const src = readFileSync(join(process.cwd(), "lib/google/gisTokenClient.ts"), "utf8");
    assert.match(src, /include_granted_scopes:\s*false/);
    assert.doesNotMatch(src, /include_granted_scopes:\s*true/);
  });

  it("is used by Drive picker, clientAuth, and sheets helpers", () => {
    const picker = readFileSync(join(process.cwd(), "components/documents/GoogleDrivePicker.tsx"), "utf8");
    const client = readFileSync(join(process.cwd(), "lib/google/clientAuth.ts"), "utf8");
    const sheets = readFileSync(join(process.cwd(), "lib/google/sheets.ts"), "utf8");
    for (const src of [picker, client, sheets]) {
      assert.match(src, /createGisTokenClient/);
    }
  });
});

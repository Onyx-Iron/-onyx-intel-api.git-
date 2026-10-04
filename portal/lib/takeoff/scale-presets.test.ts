import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchScalePreset, pageSpaceFactorForPreset } from "./scale-presets.ts";

describe("scale presets", () => {
  it("matches architectural and engineering title-block scales", () => {
    const arch = matchScalePreset('SCALE: 1/4" = 1\'-0"');
    const eng = matchScalePreset('1" = 20\'');
    assert.equal(arch?.feetPerPaperInch, 4);
    assert.equal(eng?.feetPerPaperInch, 20);
    assert.ok(arch && pageSpaceFactorForPreset(arch) > 0);
  });
});

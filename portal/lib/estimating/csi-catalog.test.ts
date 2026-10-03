import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listCsiDivisions, listCsiSections, lookupCsi, normalizeLineType } from "./csi-catalog.ts";

describe("CSI catalog", () => {
  it("covers the MasterFormat divisions used on a civil estimate", () => {
    const divisions = listCsiDivisions();
    assert.equal(divisions.length, 36);
    assert.equal(listCsiSections().length, 192);
    const codes = new Set(divisions.map((division) => division.code));
    for (const code of ["03", "31", "32", "33", "40", "48"]) assert.equal(codes.has(code), true);
    const concrete = lookupCsi("03 30 00");
    assert.equal(concrete.division?.code, "03");
    assert.equal(concrete.section?.code, "03-30-00");
    assert.equal(normalizeLineType("labor"), "labour");
  });
});
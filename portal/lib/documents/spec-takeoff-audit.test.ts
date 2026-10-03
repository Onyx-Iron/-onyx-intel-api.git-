import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { draftSpecRfi, extractCsiCodes, specCodesMissingFromTakeoff } from "./spec-takeoff-audit.ts";

describe("spec versus takeoff CSI", () => {
  it("reads separated MasterFormat codes and skips divisions above 49", () => {
    assert.deepEqual(extractCsiCodes("Provide cast-in-place concrete 03 30 00 and metal 05-12-00. Call 555-12-12."), [
      "03 30 00",
      "05 12 00",
    ]);
  });

  it("flags a spec code the takeoff does not have and cites the page", () => {
    const gaps = specCodesMissingFromTakeoff([
      {
        document_id: "spec-1",
        page_number: 4,
        file_name: "Specs.pdf",
        content: "Section 03 30 00 Cast-in-place concrete shall be 4000 psi.",
      },
      {
        document_id: "spec-1",
        page_number: 9,
        file_name: "Specs.pdf",
        content: "Section 31 23 16 excavation is by the contractor.",
      },
    ], ["033000", "03-30-00"]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].code, "31 23 16");
    assert.equal(gaps[0].pageNumber, 9);
    const draft = draftSpecRfi(gaps);
    assert.match(draft.body, /31 23 16/);
    assert.match(draft.body, /pending review/);
  });
});

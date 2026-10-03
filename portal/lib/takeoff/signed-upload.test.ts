import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PAGE_SPLIT_BYTES } from "../documents/upload-plan.ts";
import { FUNCTION_BODY_LIMIT_BYTES } from "../vercel/function-limits.ts";
import { shouldUseSignedTakeoffUpload } from "./signed-upload.ts";

describe("signed takeoff upload", () => {
  it("posts a small PDF and a medium CAD file straight to the function", () => {
    assert.equal(shouldUseSignedTakeoffUpload({ name: "sheet.pdf", size: PAGE_SPLIT_BYTES - 1 }), false);
    assert.equal(shouldUseSignedTakeoffUpload({ name: "model.dxf", size: 20 * 1024 * 1024 }), false);
    assert.equal(shouldUseSignedTakeoffUpload({ name: "model.ifc", size: FUNCTION_BODY_LIMIT_BYTES }), false);
  });

  it("sends plan-set PDFs and oversized files through signed storage upload", () => {
    assert.equal(shouldUseSignedTakeoffUpload({ name: "plans.PDF", size: PAGE_SPLIT_BYTES }), true);
    assert.equal(shouldUseSignedTakeoffUpload({ name: "site.dxf", size: FUNCTION_BODY_LIMIT_BYTES + 1 }), true);
  });
});

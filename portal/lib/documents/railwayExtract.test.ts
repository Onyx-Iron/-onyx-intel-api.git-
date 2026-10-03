import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldEnqueueRailwayExtract } from "./railwayExtract.ts";

describe("railway extract routing", () => {
  it("sends CAD/IFC to Railway Celery and leaves PDFs on the ingest path", () => {
    assert.equal(shouldEnqueueRailwayExtract("Site.dwg"), true);
    assert.equal(shouldEnqueueRailwayExtract("UTIL.DXF"), true);
    assert.equal(shouldEnqueueRailwayExtract("model.ifc"), true);
    assert.equal(shouldEnqueueRailwayExtract("Plan-Set.pdf"), false);
    assert.equal(shouldEnqueueRailwayExtract("photo.png"), false);
  });
});

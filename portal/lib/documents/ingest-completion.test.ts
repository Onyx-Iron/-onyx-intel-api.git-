import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ingestCompletion } from "./ingest-completion.ts";

describe("ingestCompletion", () => {
  it("keeps a text-complete PDF open when geometry measurement failed", () => {
    const result = ingestCompletion({
      geometryRequired: true,
      geometryMeasured: false,
      missingPages: [],
    });
    assert.equal(result.status, "processing");
    assert.equal(result.processedAt, false);
    assert.equal(result.takeoffDone, false);
    assert.equal(result.lastErrorStep, "measure");
    assert.match(result.lastError ?? "", /Sheet geometry was not saved/);
    assert.match(result.lastError ?? "", /will retry/);
  });

  it("stays open when geometry failed and some pages had no text", () => {
    const result = ingestCompletion({
      geometryRequired: true,
      geometryMeasured: false,
      missingPages: [2, 4],
    });
    assert.equal(result.status, "processing");
    assert.match(result.lastError ?? "", /Missing pages: 2, 4/);
    assert.equal(result.lastErrorStep, "measure");
  });

  it("completes a PDF once geometry is saved, even if a text page was missing", () => {
    const result = ingestCompletion({
      geometryRequired: true,
      geometryMeasured: true,
      missingPages: [3],
    });
    assert.equal(result.status, "complete");
    assert.equal(result.processedAt, true);
    assert.equal(result.takeoffDone, true);
    assert.equal(result.lastError, null);
  });

  it("completes a non-PDF once every page has text", () => {
    const result = ingestCompletion({
      geometryRequired: false,
      geometryMeasured: false,
      missingPages: [],
    });
    assert.equal(result.status, "complete");
    assert.equal(result.takeoffDone, false);
    assert.equal(result.lastError, null);
  });

  it("keeps a non-PDF processing when text pages are missing", () => {
    const result = ingestCompletion({
      geometryRequired: false,
      geometryMeasured: false,
      missingPages: [1],
    });
    assert.equal(result.status, "processing");
    assert.equal(result.lastError, "Missing pages: 1");
    assert.equal(result.lastErrorStep, "parse");
    assert.equal(result.takeoffDone, false);
  });
});

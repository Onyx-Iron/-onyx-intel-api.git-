import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const workerSource = readFileSync(path.join(process.cwd(), "supabase/functions/page-takeoff-worker/index.ts"), "utf8");

describe("large-plan page worker governance", () => {
  it("never self-approves extracted quantities or synchronizes them directly to an estimate", () => {
    assert.doesNotMatch(workerSource, /review_status:\s*r\.extraction_method[^\n]+"approved"/);
    assert.doesNotMatch(workerSource, /await\s+syncTakeoffToEstimate\s*\(/);
    assert.match(workerSource, /review_status:\s*"suggested"/);
    assert.match(workerSource, /quantity_validation_status:\s*"unvalidated"/);
  });
});

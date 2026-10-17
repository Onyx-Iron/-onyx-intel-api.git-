import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProjectBrief } from "./project-brief.ts";

const project = {
  name: "River Park",
  status: "active",
  budget: 2500000,
  start_date: "2026-01-01",
  end_date: "2026-12-01",
  address: "1 Main",
  city: "Austin",
  state: "TX",
  meta: { estimate: 2000000, completion_pct: 10 },
};

describe("project brief", () => {
  it("includes budget and estimate only when the caller may read financials", () => {
    const hidden = buildProjectBrief(project, "2026-10-03", false);
    assert.match(hidden, /River Park/);
    assert.match(hidden, /Completion: 10%/);
    assert.doesNotMatch(hidden, /Budget/);
    assert.doesNotMatch(hidden, /2,500,000/);
    assert.doesNotMatch(hidden, /Estimate/);

    const shown = buildProjectBrief(project, "2026-10-03", true);
    assert.match(shown, /Budget: \$2,500,000/);
    assert.match(shown, /Estimate: \$2,000,000/);
  });
});

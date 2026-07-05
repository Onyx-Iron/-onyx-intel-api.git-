import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGroundedSystemPrompt } from "./grounding.ts";

describe("AI grounding contract", () => {
  it("appends evidence-only rules to construction assistant prompts", () => {
    const prompt = buildGroundedSystemPrompt("You are a construction assistant.");

    assert.match(prompt, /No supporting evidence/i);
    assert.match(prompt, /do not invent/i);
    assert.match(prompt, /takeoff/i);
    assert.match(prompt, /estimate/i);
    assert.match(prompt, /cite/i);
  });

  it("keeps route-specific instructions while adding stronger document rules", () => {
    const prompt = buildGroundedSystemPrompt("Answer using only the attached PDF.", {
      requireCitations: true,
      sourceLabel: "attached PDF",
    });

    assert.match(prompt, /attached PDF/);
    assert.match(prompt, /Answer using only the attached PDF/);
    assert.match(prompt, /cite the attached PDF/i);
    assert.match(prompt, /If the source does not contain the answer/i);
  });
});

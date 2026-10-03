import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { geminiAnswerText } from "./gemini.ts";

describe("geminiAnswerText", () => {
  it("skips thought parts and keeps the JSON answer", () => {
    assert.equal(geminiAnswerText([
      { thought: true, text: "planning the extraction" },
      { text: "{\"doc_type\":\"drawing\"}" },
    ]), "{\"doc_type\":\"drawing\"}");
  });

  it("returns an empty string when the model only sent thoughts", () => {
    assert.equal(geminiAnswerText([{ thought: true, text: "still thinking" }]), "");
    assert.equal(geminiAnswerText(undefined), "");
  });
});

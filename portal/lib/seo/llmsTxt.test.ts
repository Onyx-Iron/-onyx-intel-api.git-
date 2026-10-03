import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLlmsTxt, buildOrganizationJsonLd } from "./llmsTxt.ts";

describe("llmsTxt", () => {
  it("builds markdown with company name and services", () => {
    const txt = buildLlmsTxt({
      companyName: "Onyx Iron",
      websiteUrl: "https://onyx-iron.com",
      serviceAreas: ["Texas"],
    });
    assert.match(txt, /# Onyx Iron/);
    assert.match(txt, /Texas/);
    assert.match(txt, /construction estimating/);
  });

  it("builds Organization JSON-LD", () => {
    const ld = buildOrganizationJsonLd({ name: "Onyx Iron", url: "https://onyx-iron.com" });
    assert.equal(ld["@type"], "Organization");
    assert.equal(ld.name, "Onyx Iron");
  });
});

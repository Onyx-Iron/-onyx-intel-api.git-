import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("optional AI provider boundaries", () => {
  it("does not require Gemini while Next.js is collecting route modules", () => {
    const route = readFileSync(
      join(process.cwd(), "app", "api", "documents", "[id]", "ingest", "route.ts"),
      "utf8",
    );

    assert.doesNotMatch(route, /requireEnv\(["']GEMINI_API_KEY["']\)/);
    assert.match(route, /code:\s*["']NO_PROVIDER["']/);
  });
});

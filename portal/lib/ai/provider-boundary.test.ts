import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeModelFiles = [
  join("app", "api", "documents", "[id]", "ingest", "route.ts"),
  join("app", "api", "ai", "chat", "route.ts"),
  join("app", "api", "ai", "risk-digest", "route.ts"),
  join("app", "api", "takeoff", "extract", "route.ts"),
  join("app", "api", "takeoff", "canvas", "vision-extract", "route.ts"),
  join("lib", "ai", "providers.ts"),
  join("lib", "ai", "preference.ts"),
  join("lib", "parse", "pdf.ts"),
  join("lib", "parse", "image.ts"),
  join("supabase", "functions", "page-processor", "index.ts"),
];

describe("optional AI provider boundaries", () => {
  it("does not require Gemini while Next.js is collecting route modules", () => {
    const route = readFileSync(
      join(process.cwd(), "app", "api", "documents", "[id]", "ingest", "route.ts"),
      "utf8",
    );

    assert.doesNotMatch(route, /requireEnv\(["']GEMINI_API_KEY["']\)/);
    assert.match(route, /code:\s*["']NO_PROVIDER["']/);
  });

  it("does not ship retired Gemini generation or embedding model defaults", () => {
    const source = runtimeModelFiles
      .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /gemini-2\.0-flash(?:-001)?|text-embedding-004/);
    assert.match(source, /gemini-3\.6-flash/);
    assert.match(source, /gemini-embedding-2/);
    assert.match(source, /outputDimensionality:\s*768/);
  });
});

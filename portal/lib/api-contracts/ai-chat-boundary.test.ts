import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const source = readFileSync(resolve(process.cwd(), "app/api/ai/chat/route.ts"), "utf8");

describe("project AI chat boundaries", () => {
  it("requires financial read access before loading project-wide AI context", () => {
    assert.ok(source.includes('assertPermission(tenantId, userId, "financial", "read")'));
    assert.ok(source.includes("err instanceof PermissionError ? 403"));
  });

  it("binds supplied conversations to the active tenant and project", () => {
    const projectScopeMatches = source.match(/\.eq\("project_id", project_id\)/g) ?? [];
    assert.ok(projectScopeMatches.length >= 4);
    assert.ok(source.includes("Conversation not found for this project"));
  });
});

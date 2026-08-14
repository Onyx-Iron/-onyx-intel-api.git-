import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const FIELD_WRITE_ROUTES = [
  "app/api/daily-logs/route.ts",
  "app/api/daily-logs/[id]/route.ts",
  "app/api/punch-list/route.ts",
  "app/api/punch-list/[id]/route.ts",
  "app/api/schedule/route.ts",
  "app/api/schedule/[id]/route.ts",
  "app/api/todo-items/route.ts",
  "app/api/todo-items/[id]/route.ts",
  "app/api/weekly-logs/route.ts",
  "app/api/weekly-logs/[id]/route.ts",
  "app/api/co-inspections/route.ts",
  "app/api/co-inspections/[id]/route.ts",
];

describe("operational API authorization policy", () => {
  for (const file of FIELD_WRITE_ROUTES) {
    it(`${file} requires field write permission`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("assertPermission("));
      assert.ok(source.includes('"field", "write"'));
    });
  }

  for (const file of ["app/api/projects/route.ts", "app/api/projects/[id]/route.ts"]) {
    it(`${file} restricts project mutation to administrators`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("assertPermission("));
      assert.ok(source.includes('"admin", "write"'));
    });
  }
});

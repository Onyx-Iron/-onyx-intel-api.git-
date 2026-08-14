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
  "app/api/documents/upload/route.ts",
  "app/api/documents/[id]/ingest/route.ts",
  "app/api/takeoff/from-document/route.ts",
  "app/api/takeoff/extract/route.ts",
  "app/api/takeoff/items/route.ts",
  "app/api/takeoff/canvas/vision-extract/route.ts",
  "app/api/documents/route.ts",
  "app/api/documents/import-drive/route.ts",
  "app/api/documents/upload-url/route.ts",
  "app/api/documents/[id]/retry/route.ts",
  "app/api/daily-logs/photo/route.ts",
  "app/api/earthwork/entrances/route.ts",
  "app/api/earthwork/ledger/route.ts",
  "app/api/earthwork/pipe-runs/route.ts",
  "app/api/earthwork/stockpiles/route.ts",
  "app/api/earthwork/surfaces/route.ts",
  "app/api/earthwork/volumes/route.ts",
  "app/api/cut-fill/compute/route.ts",
  "app/api/cut-fill/surfaces/route.ts",
  "app/api/cut-fill/surfaces/[id]/route.ts",
  "app/api/contacts/route.ts",
  "app/api/contacts/[id]/route.ts",
  "app/api/generated-docs/route.ts",
  "app/api/takeoff/drive-upload-session/route.ts",
  "app/api/takeoff/drive-upload-session/finalize/route.ts",
  "app/api/takeoff/upload-url/route.ts",
  "app/api/takeoff/canvas/area-bounds/route.ts",
  "app/api/takeoff/canvas/topo/route.ts",
  "app/api/takeoff/canvas/utility/route.ts",
  "app/api/takeoff/canvas/calibration/route.ts",
  "app/api/takeoff/canvas/vectors/route.ts",
  "app/api/takeoff/canvas/manual/route.ts",
  "app/api/weekly-logs/[id]/generate/route.ts",
  "app/api/marketing/leads/route.ts",
  "app/api/agents/daily-log-assistant/route.ts",
  "app/api/construction-intelligence/scope/route.ts",
];

describe("operational API authorization policy", () => {
  for (const file of FIELD_WRITE_ROUTES) {
    it(`${file} requires field write permission`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("assertPermission(") || source.includes("hasPermission("));
      assert.ok(source.includes('"field", "write"'));
    });
  }

  for (const file of ["app/api/projects/route.ts", "app/api/projects/[id]/route.ts", "app/api/companies/route.ts"]) {
    it(`${file} restricts project mutation to administrators`, () => {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      assert.ok(source.includes("assertPermission(") || source.includes("hasPermission("));
      assert.ok(source.includes('"admin", "write"'));
    });
  }

  it("tenant guard requires administrator permission", () => {
    const source = readFileSync(resolve(process.cwd(), "app/api/agents/tenant-guard/route.ts"), "utf8");
    assert.ok(source.includes("assertPermission(") || source.includes("hasPermission("));
    assert.ok(source.includes('"admin", "write"'));
  });
});

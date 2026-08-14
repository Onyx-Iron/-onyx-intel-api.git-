import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const ROUTES: Array<{ file: string; permissions: string[] }> = [
  { file: "app/api/invoices/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/invoices/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/lien-waivers/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/lien-waivers/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/cost-catalog/route.ts", permissions: ['"financial", "read"', '"financial", "write"'] },
  { file: "app/api/cost-catalog/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/cost-catalog/actuals/route.ts", permissions: ['"financial", "read"', '"financial", "write"'] },
  { file: "app/api/cost-catalog/seed/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/cost-catalog/v2/route.ts", permissions: ['"financial", "read"'] },
  { file: "app/api/cost-catalog/overrides/route.ts", permissions: ['"financial", action'] },
  { file: "app/api/cost-catalog/overrides/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/estimate/matrix/route.ts", permissions: ['"financial", "read"'] },
  { file: "app/api/equipment-suppliers/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/equipment-suppliers/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/material-vendors/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/material-vendors/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/staff/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/staff/[id]/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/takeoff/approval-preview/[id]/confirm/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/agents/audit-trails/[id]/decide/route.ts", permissions: ['"financial", "write"'] },
  { file: "app/api/reports/route.ts", permissions: ['"financial", "read"'] },
];

describe("financial API authorization policy", () => {
  for (const route of ROUTES) {
    it(`${route.file} enforces its financial permission`, () => {
      const source = readFileSync(resolve(process.cwd(), route.file), "utf8");
      assert.ok(source.includes("assertPermission(") || source.includes("hasPermission("));
      for (const permission of route.permissions) assert.ok(source.includes(permission));
    });
  }
});

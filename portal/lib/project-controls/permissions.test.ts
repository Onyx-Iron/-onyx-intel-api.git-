import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canPerform, redactFinancialFields, type Role } from "./permissions.ts";

const PRICING_ROLES: readonly Role[] = ["Owner", "Admin", "Estimator", "ProjectManager"];
const RESTRICTED_ROLES: readonly Role[] = ["FieldSuperintendent", "Subcontractor", "ClientView"];

describe("project permissions", () => {
  it("shows financial amounts only to roles that can price the job", () => {
    for (const role of PRICING_ROLES) {
      assert.equal(canPerform(role, "financial", "read"), true, role);
      assert.equal(canPerform(role, "financial", "write"), true, role);
    }
    for (const role of RESTRICTED_ROLES) {
      assert.equal(canPerform(role, "financial", "read"), false, role);
      assert.equal(canPerform(role, "financial", "write"), false, role);
    }
  });

  it("lets the field write field records and keeps admin writes to owners", () => {
    assert.equal(canPerform("FieldSuperintendent", "field", "write"), true);
    assert.equal(canPerform("Subcontractor", "field", "write"), true);
    assert.equal(canPerform("ClientView", "field", "read"), true);
    assert.equal(canPerform("ClientView", "field", "write"), false);
    assert.equal(canPerform("ClientView", "admin", "write"), false);
    assert.equal(canPerform("Estimator", "admin", "write"), false);
    assert.equal(canPerform("Owner", "admin", "write"), true);
    assert.equal(canPerform("Admin", "admin", "read"), true);
  });

  it("nulls financial fields for a restricted role and leaves the source row intact", () => {
    const row = { id: "item-1", unit_cost: 12, description: "pipe" };
    const hidden = redactFinancialFields([row], "ClientView", ["unit_cost", "profit"]);
    assert.equal(hidden[0]?.unit_cost, null);
    assert.equal(hidden[0]?.description, "pipe");
    assert.equal(row.unit_cost, 12);

    const rows = [row];
    const visible = redactFinancialFields(rows, "Estimator", ["unit_cost"]);
    assert.equal(visible[0]?.unit_cost, 12);
    assert.equal(visible, rows);
  });
});

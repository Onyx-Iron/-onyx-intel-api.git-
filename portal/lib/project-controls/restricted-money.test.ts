import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  redactCostActualRows,
  redactCostOverrideRows,
  redactOpportunityRows,
  redactProcurementRead,
  redactResolvedCosts,
  redactStaffItems,
} from "./financial-redaction.ts";
import type { Role } from "./permissions.ts";

const RESTRICTED: Role[] = ["ClientView", "Subcontractor", "FieldSuperintendent"];

describe("restricted money reads", () => {
  it("hides staff pay, bid prices, PO totals, and catalog rates from roles that cannot price a bid", () => {
    for (const role of RESTRICTED) {
      const [staff] = redactStaffItems([{ name: "Ada", hourly_rate: 85 }], role);
      assert.equal(staff.name, "Ada");
      assert.equal(staff.hourly_rate, null);

      const [opportunity] = redactOpportunityRows([{ name: "School", bid_value: 250000, stage: "pricing" }], role);
      assert.equal(opportunity.stage, "pricing");
      assert.equal(opportunity.bid_value, null);

      const visible = redactProcurementRead(
        [{
          batch_id: "b1",
          items: [{
            item_description: "Pipe",
            quantity: 100,
            bids: [{ vendor_name: "Acme", unit_price: 12.5, lead_time_days: 4 }],
          }],
        }],
        [{ po_number: 7, total_amount: 1250, status: "issued" }],
        role,
      );
      assert.equal(visible.batches[0].items[0].quantity, 100);
      assert.equal(visible.batches[0].items[0].bids?.[0].vendor_name, "Acme");
      assert.equal(visible.batches[0].items[0].bids?.[0].unit_price, null);
      assert.equal(visible.batches[0].items[0].bids?.[0].lead_time_days, 4);
      assert.equal(visible.purchaseOrders[0].po_number, 7);
      assert.equal(visible.purchaseOrders[0].total_amount, null);

      const [override] = redactCostOverrideRows([{ csi_code: "03-30-00", unit_cost: 180, labor_cost: 40 }], role);
      assert.equal(override.csi_code, "03-30-00");
      assert.equal(override.unit_cost, null);
      assert.equal(override.labor_cost, null);

      const [actual] = redactCostActualRows([{ csi_code: "03-30-00", actual_unit_cost: 190, estimated_unit_cost: 180, variance_pct: 5.5 }], role);
      assert.equal(actual.actual_unit_cost, null);
      assert.equal(actual.estimated_unit_cost, null);
      assert.equal(actual.variance_pct, null);

      const [resolved] = redactResolvedCosts([{ cost_code: "03-30-00", unit_cost: 180, material_cost: 90, source: "national_price" }], role);
      assert.equal(resolved.cost_code, "03-30-00");
      assert.equal(resolved.source, "national_price");
      assert.equal(resolved.unit_cost, null);
      assert.equal(resolved.material_cost, null);
    }
  });

  it("keeps those amounts for an estimator", () => {
    const [staff] = redactStaffItems([{ hourly_rate: 85 }], "Estimator");
    assert.equal(staff.hourly_rate, 85);
    const visible = redactProcurementRead(
      [{ items: [{ bids: [{ unit_price: 12.5 }] }] }],
      [{ total_amount: 1250 }],
      "Estimator",
    );
    assert.equal(visible.batches[0].items[0].bids?.[0].unit_price, 12.5);
    assert.equal(visible.purchaseOrders[0].total_amount, 1250);
  });
});

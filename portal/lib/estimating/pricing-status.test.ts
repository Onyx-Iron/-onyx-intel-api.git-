import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pricingStatusAfterEdit } from "./pricing-status.ts";

const reviewLine = {
  quantity: 10,
  labor_cost: 0,
  material_cost: 250,
  equipment_cost: 0,
  trucking_cost: 0,
  subcontract_cost: 0,
  disposal_cost: 0,
  pricing_status: "review",
};

describe("pricingStatusAfterEdit", () => {
  it("keeps review when a description save round-trips the same unit rates", () => {
    const status = pricingStatusAfterEdit(reviewLine, {
      ...reviewLine,
      quantity: 10,
      material_cost: 250,
    });
    assert.equal(status, "review");
  });

  it("keeps review when only the quantity changes", () => {
    const status = pricingStatusAfterEdit(reviewLine, {
      ...reviewLine,
      quantity: 12,
      material_cost: 300,
    });
    assert.equal(status, "review");
  });

  it("marks the line manual once a unit rate changes", () => {
    const status = pricingStatusAfterEdit(reviewLine, {
      ...reviewLine,
      material_cost: 400,
    });
    assert.equal(status, "manual");
  });

  it("keeps an unpriced line unpriced until a rate is entered", () => {
    const status = pricingStatusAfterEdit(
      { ...reviewLine, material_cost: 0, pricing_status: "unpriced" },
      { ...reviewLine, material_cost: 0, pricing_status: "unpriced" },
    );
    assert.equal(status, "unpriced");
  });

  it("starts a brand-new row as manual", () => {
    assert.equal(pricingStatusAfterEdit(null, reviewLine), "manual");
  });

  it("keeps review when the database returns numeric strings", () => {
    const status = pricingStatusAfterEdit(
      { ...reviewLine, quantity: "10", material_cost: "250.00" },
      { ...reviewLine, quantity: 10, material_cost: 250 },
    );
    assert.equal(status, "review");
  });
});

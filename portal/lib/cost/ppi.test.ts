import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ageInDays,
  csiDivisionFromCode,
  actualsNeedPpiAging,
  escalateStaleUnitCost,
  PPI_STALE_AFTER_DAYS,
  scaleOptionalCost,
} from "./ppi.ts";

describe("csiDivisionFromCode", () => {
  it("reads the leading two-digit division", () => {
    assert.equal(csiDivisionFromCode("03-30-00"), "03");
    assert.equal(csiDivisionFromCode("31-23-23"), "31");
  });
});

describe("escalateStaleUnitCost", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const stale = "2026-05-01T00:00:00Z"; // > 90 days before now
  const fresh = "2026-09-15T00:00:00Z";
  const trends = new Map([["03", 10], ["05", -5]]);

  it("ages stale catalog prices by division PPI", () => {
    const r = escalateStaleUnitCost({
      unitCost: 100,
      observedAt: stale,
      csiCodeOrDivision: "03-30-00",
      pctChangeByDivision: trends,
      now,
    });
    assert.equal(r.escalated, true);
    assert.equal(r.unitCost, 110);
    assert.equal(r.pctApplied, 10);
  });

  it("leaves fresh prices alone", () => {
    const r = escalateStaleUnitCost({
      unitCost: 100,
      observedAt: fresh,
      csiCodeOrDivision: "03-30-00",
      pctChangeByDivision: trends,
      now,
    });
    assert.equal(r.escalated, false);
    assert.equal(r.unitCost, 100);
  });

  it("leaves overrides of unknown division alone", () => {
    const r = escalateStaleUnitCost({
      unitCost: 100,
      observedAt: stale,
      csiCodeOrDivision: "99-00-00",
      pctChangeByDivision: trends,
      now,
    });
    assert.equal(r.escalated, false);
  });

  it("respects staleAfterDays default", () => {
    assert.ok(ageInDays(stale, now)! >= PPI_STALE_AFTER_DAYS);
  });
});

describe("actuals window", () => {
  it("does not PPI-age actuals already inside six months", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const inside = new Date("2026-06-15T00:00:00Z");
    const outside = new Date("2026-01-01T00:00:00Z");
    assert.equal(actualsNeedPpiAging(inside, now), false);
    assert.equal(actualsNeedPpiAging(outside, now), true);
  });
});

describe("scaleOptionalCost", () => {
  it("scales component costs with the unit-cost factor", () => {
    assert.equal(scaleOptionalCost(40, 100, 110), 44);
  });
});

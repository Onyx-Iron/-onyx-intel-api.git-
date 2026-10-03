import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scaleMoney, selectLocationFactor } from "./location-adjust.ts";

const now = new Date("2026-10-03T00:00:00.000Z");

describe("location factor", () => {
  it("scales a national price by the state index and ignores a national-looking factor", () => {
    const texas = selectLocationFactor({
      now,
      regionCandidates: ["78701", "Austin", "TX"],
      rows: [
        { regionCode: "US", indexValue: 100, observedAt: "2026-08-01", seriesCode: "cci", source: "enr_cci" },
        { regionCode: "TX", indexValue: 92.4, observedAt: "2026-08-01", seriesCode: "cci", source: "enr_cci" },
        { regionCode: "CA", indexValue: 140, observedAt: "2026-08-01", seriesCode: "cci", source: "enr_cci" },
      ],
    });
    assert.equal(texas?.regionCode, "TX");
    assert.equal(texas?.factor, 0.924);
    assert.equal(scaleMoney(100, texas?.factor ?? 1), 92.4);

    const flat = selectLocationFactor({
      now,
      regionCandidates: ["TX"],
      rows: [
        { regionCode: "US", indexValue: 100, observedAt: "2026-08-01", source: "location_factor" },
        { regionCode: "TX", indexValue: 100.5, observedAt: "2026-08-01", source: "location_factor" },
      ],
    });
    assert.equal(flat, null);
  });

  it("uses the row base when no national series is stored, and skips a stale or commodity index", () => {
    const fromBase = selectLocationFactor({
      now,
      regionCandidates: ["TX"],
      rows: [{ regionCode: "TX", indexValue: 118, baseValue: 100, observedAt: "2026-06-01", seriesCode: "lci" }],
    });
    assert.equal(fromBase?.factor, 1.18);

    const stale = selectLocationFactor({
      now,
      regionCandidates: ["TX"],
      rows: [{ regionCode: "TX", indexValue: 118, baseValue: 100, observedAt: "2020-01-01", seriesCode: "lci" }],
    });
    assert.equal(stale, null);

    const commodity = selectLocationFactor({
      now,
      regionCandidates: ["TX"],
      rows: [{ regionCode: "TX", indexValue: 140, baseValue: 100, observedAt: "2026-08-01", seriesCode: "WPU132", source: "bls_ppi" }],
    });
    assert.equal(commodity, null);
  });
});

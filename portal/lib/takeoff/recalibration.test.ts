import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { commitRecalibratedDrafts, previewRecalibration, recalibrationNeedsConfirm } from "./recalibration.ts";

describe("recalibration preview", () => {
  it("scales length and perimeter linearly, area by the square, and leaves counts", () => {
    const lines = previewRecalibration(
      [
        { id: "l", takeoff_type: "length", quantity: 10, label: "Wall" },
        { id: "p", takeoff_type: "perimeter", quantity: 40 },
        { id: "a", takeoff_type: "area", quantity: 100, label: "Slab" },
        { id: "c", takeoff_type: "count", quantity: 4, label: "Doors" },
      ],
      1,
      2,
    );
    assert.equal(lines[0].after, 20);
    assert.equal(lines[1].after, 80);
    assert.equal(lines[2].after, 400);
    assert.equal(lines[3].after, 4);
    assert.equal(lines[3].recomputed, false);
    assert.equal(recalibrationNeedsConfirm(lines), true);
  });

  it("does not invent quantities when the old scale factor is missing", () => {
    const lines = previewRecalibration(
      [{ id: "l", takeoff_type: "length", quantity: 10 }],
      null,
      2,
    );
    assert.equal(lines[0].after, 10);
    assert.equal(lines[0].recomputed, false);
    assert.equal(recalibrationNeedsConfirm(lines), false);
  });
});

describe("commit recalibrated drafts", () => {
  it("syncs the draft estimate after a quantity write", async () => {
    const written: string[] = [];
    let synced = 0;
    const result = await commitRecalibratedDrafts({
      lines: previewRecalibration(
        [
          { id: "wall", takeoff_type: "length", quantity: 100 },
          { id: "doors", takeoff_type: "count", quantity: 4 },
        ],
        1,
        2,
      ),
      write: async (line) => {
        written.push(line.id);
        return { ok: true };
      },
      syncEstimate: async () => {
        synced++;
      },
    });
    assert.deepEqual(written, ["wall"]);
    assert.equal(synced, 1);
    assert.equal(result.updated, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(result.estimateError, null);
  });

  it("does not sync when every quantity write fails", async () => {
    let synced = 0;
    const result = await commitRecalibratedDrafts({
      lines: previewRecalibration([{ id: "wall", takeoff_type: "length", quantity: 100 }], 1, 2),
      write: async () => ({ ok: false, reason: "conflict" }),
      syncEstimate: async () => {
        synced++;
      },
    });
    assert.equal(synced, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.failures[0]?.reason, "conflict");
    assert.equal(result.estimateError, null);
  });

  it("reports an estimate sync failure after the quantities were saved", async () => {
    const result = await commitRecalibratedDrafts({
      lines: previewRecalibration([{ id: "slab", takeoff_type: "area", quantity: 100 }], 1, 2),
      write: async () => ({ ok: true }),
      syncEstimate: async () => {
        throw new Error("estimate down");
      },
    });
    assert.equal(result.updated, 1);
    assert.equal(result.estimateError, "estimate down");
  });
});

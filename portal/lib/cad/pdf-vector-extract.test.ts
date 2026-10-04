import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { flattenCubic, pdfChannelHex, polylineLength } from "./pdf-vector-extract.ts";

describe("pdf vector geometry", () => {
  it("keeps a 0–1 red channel red", () => {
    assert.equal(pdfChannelHex(1, 0, 0), "#ff0000");
    assert.equal(pdfChannelHex(0, 0, 1), "#0000ff");
  });

  it("measures a bowed cubic longer than the straight chord", () => {
    const start: [number, number] = [0, 0];
    const end: [number, number] = [10, 0];
    const chords = flattenCubic(start, [0, 10], [10, 10], end);
    const curve = polylineLength([start, ...chords]);
    const chord = polylineLength([start, end]);
    assert.ok(curve > chord);
  });
});

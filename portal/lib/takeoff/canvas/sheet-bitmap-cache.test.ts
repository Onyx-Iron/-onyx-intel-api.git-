import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clearSheetBitmapCache,
  matchingSheetBitmap,
  rememberSheetBitmap,
  sheetRenderScale,
} from "./sheet-bitmap-cache.ts";

describe("sheet bitmap cache", () => {
  it("computes the same render scale the canvas uses", () => {
    assert.equal(sheetRenderScale(1380, 1000), 1);
    assert.equal(sheetRenderScale(500, 1000), 0.5);
    assert.equal(sheetRenderScale(4000, 1000), 2.5);
  });

  it("returns a bitmap only when the container still maps to the cached scale", () => {
    clearSheetBitmapCache();
    let closed = 0;
    rememberSheetBitmap("page-1", {
      pageWidth: 1000,
      pageHeight: 800,
      scale: sheetRenderScale(1380, 1000),
      bitmap: { close: () => { closed += 1; } },
    });

    assert.equal(matchingSheetBitmap("page-1", 1380)?.scale, 1);
    assert.equal(matchingSheetBitmap("page-1", 900), null);
    assert.equal(closed, 0);
  });

  it("keeps four sheets and closes the oldest bitmap", () => {
    clearSheetBitmapCache();
    const closed: string[] = [];
    for (const id of ["a", "b", "c", "d", "e"]) {
      rememberSheetBitmap(id, {
        pageWidth: 1000,
        pageHeight: 800,
        scale: 1,
        bitmap: { close: () => closed.push(id) },
      });
    }
    assert.deepEqual(closed, ["a"]);
    assert.equal(matchingSheetBitmap("a", 1380), null);
    assert.equal(matchingSheetBitmap("e", 1380)?.scale, 1);
    clearSheetBitmapCache();
  });
});

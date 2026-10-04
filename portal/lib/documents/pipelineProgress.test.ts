import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStageProgress,
  summarizePipelineProgress,
  type PageProgressRow,
} from "./pipelineProgress.ts";

function row(partial: Partial<PageProgressRow> & { id: string; page_number: number }): PageProgressRow {
  return {
    status: "pending",
    takeoff_status: "pending",
    error: null,
    takeoff_error: null,
    ...partial,
  };
}

describe("summarizePipelineProgress", () => {
  it("counts OCR and takeoff stages independently", () => {
    const rows = [
      row({ id: "a", page_number: 1, status: "done", takeoff_status: "done" }),
      row({ id: "b", page_number: 2, status: "done", takeoff_status: "processing" }),
      row({ id: "c", page_number: 3, status: "error", takeoff_status: "error", error: "ocr boom" }),
      row({ id: "d", page_number: 4, status: "pending", takeoff_status: "pending" }),
    ];
    const p = summarizePipelineProgress(rows);
    assert.equal(p.ocr.total, 4);
    assert.equal(p.ocr.done, 2);
    assert.equal(p.ocr.error, 1);
    assert.equal(p.ocr.pending, 1);
    assert.equal(p.takeoff.done, 1);
    assert.equal(p.takeoff.processing, 1);
    assert.equal(p.takeoff.error, 1);
    assert.equal(p.finished, false);
    assert.equal(p.failed_pages.length, 1);
    assert.equal(p.failed_pages[0]?.page_number, 3);
  });

  it("marks finished when every page is terminal on both stages", () => {
    const rows = [
      row({ id: "a", page_number: 1, status: "done", takeoff_status: "done" }),
      row({ id: "b", page_number: 2, status: "error", takeoff_status: "skipped" }),
    ];
    const p = summarizePipelineProgress(rows);
    assert.equal(p.finished, true);
    assert.equal(p.failed_pages.length, 1);
  });

  it("formats stage progress for the UI", () => {
    assert.equal(
      formatStageProgress("OCR", { total: 10, done: 7, error: 1, pending: 1, processing: 1 }),
      "OCR 8/10 (1 err)",
    );
    assert.equal(
      formatStageProgress("Takeoff", { total: 0, done: 0, error: 0, pending: 0, processing: 0 }),
      "Takeoff —",
    );
  });
});

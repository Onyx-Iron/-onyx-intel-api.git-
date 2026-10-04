import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  documentStatusAfterPageRetry,
  planPageRetry,
  type RetryablePageRow,
} from "./retryPage.ts";

function page(partial: Partial<RetryablePageRow> = {}): RetryablePageRow {
  return {
    id: "p1",
    status: "error",
    takeoff_status: "error",
    storage_path: "tenant/doc/page-1.pdf",
    page_number: 1,
    document_id: "d1",
    tenant_id: "t1",
    ...partial,
  };
}

describe("planPageRetry", () => {
  it("retries both failed stages by default", () => {
    const plan = planPageRetry(page());
    assert.ok(!("error" in plan));
    if ("error" in plan) return;
    assert.deepEqual(plan.stages, ["ocr", "takeoff"]);
    assert.equal(plan.pagePatch.status, "pending");
    assert.equal(plan.pagePatch.takeoff_status, "pending");
  });

  it("retries only OCR when takeoff succeeded", () => {
    const plan = planPageRetry(page({ takeoff_status: "done" }));
    assert.ok(!("error" in plan));
    if ("error" in plan) return;
    assert.deepEqual(plan.stages, ["ocr"]);
    assert.equal(plan.pagePatch.status, "pending");
    assert.equal(plan.pagePatch.takeoff_status, undefined);
  });

  it("honors explicit stage request", () => {
    const plan = planPageRetry(page(), ["takeoff"]);
    assert.ok(!("error" in plan));
    if ("error" in plan) return;
    assert.deepEqual(plan.stages, ["takeoff"]);
  });

  it("rejects retry when stage is not failed", () => {
    const plan = planPageRetry(page({ status: "done", takeoff_status: "done" }), ["ocr"]);
    assert.ok("error" in plan);
  });

  it("rejects missing storage_path", () => {
    const plan = planPageRetry(page({ storage_path: null }));
    assert.ok("error" in plan);
  });
});

describe("documentStatusAfterPageRetry", () => {
  it("moves terminal failure back to split for polling", () => {
    assert.equal(documentStatusAfterPageRetry("complete_with_errors"), "split");
    assert.equal(documentStatusAfterPageRetry("error"), "split");
    assert.equal(documentStatusAfterPageRetry("processing"), null);
  });
});

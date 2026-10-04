import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reconcileDocumentPages,
  reconcileSheets,
} from "../../supabase/functions/_shared/split-reconcile.ts";

const base = {
  tenantId: "tenant-1",
  documentId: "doc-1",
};

function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe("reconcileDocumentPages", () => {
  it("inserts every page on the first split", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [],
      uploadedPageNumbers: [1, 2],
      pageCount: 2,
      newId: ids("page"),
    });
    assert.deepEqual(plan.deleteIds, []);
    assert.equal(plan.pages.length, 2);
    assert.equal(plan.pages[0].id, "page-1");
    assert.equal(plan.pages[0].insert, true);
    assert.equal(plan.pages[0].enqueueOcr, true);
    assert.equal(plan.pages[0].enqueueTakeoff, true);
    assert.equal(plan.pages[1].storage_path, "pages/doc-1/page-2.pdf");
  });

  it("keeps page ids on retry so calibrations are not cascade-deleted", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "done" },
        { id: "page-b", page_number: 2, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [1, 2],
      pageCount: 2,
      newId: ids("new"),
    });
    assert.deepEqual(plan.deleteIds, []);
    assert.deepEqual(plan.pages.map((page) => page.id), ["page-a", "page-b"]);
    assert.equal(plan.pages.every((page) => page.insert === false), true);
    assert.equal(plan.pages.every((page) => page.enqueueOcr === false), true);
    assert.equal(plan.pages.every((page) => page.enqueueTakeoff === false), true);
  });

  it("requeues only unfinished pages and drops pages the shorter pdf no longer has", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "error" },
        { id: "page-b", page_number: 2, status: "error", takeoff_status: "pending" },
        { id: "page-c", page_number: 3, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [1, 2],
      pageCount: 2,
      newId: ids("new"),
    });
    assert.deepEqual(plan.deleteIds, ["page-c"]);
    assert.equal(plan.pages[0].id, "page-a");
    assert.equal(plan.pages[0].enqueueOcr, false);
    assert.equal(plan.pages[0].enqueueTakeoff, true);
    assert.equal(plan.pages[1].id, "page-b");
    assert.equal(plan.pages[1].enqueueOcr, true);
    assert.equal(plan.pages[1].enqueueTakeoff, true);
  });

  it("does not reset a page whose replacement upload failed", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [],
      pageCount: 1,
      newId: ids("new"),
    });
    assert.equal(plan.pages.length, 1);
    assert.equal(plan.pages[0].id, "page-a");
    assert.equal(plan.pages[0].enqueueOcr, false);
    assert.equal(plan.pages[0].enqueueTakeoff, false);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("plans a new insert when the existing row was not in the loaded page", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [1001],
      pageCount: 1001,
      newId: ids("new"),
    });
    const inserted = plan.pages.find((page) => page.page_number === 1001);
    assert.equal(inserted?.insert, true);
    assert.notEqual(inserted?.id, "page-a");
  });

  it("collapses duplicate page rows and keeps the lowest id", () => {
    const plan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-b", page_number: 1, status: "done", takeoff_status: "done" },
        { id: "page-a", page_number: 1, status: "pending", takeoff_status: "pending" },
      ],
      uploadedPageNumbers: [1],
      pageCount: 1,
      newId: ids("new"),
    });
    assert.deepEqual(plan.deleteIds, ["page-b"]);
    assert.equal(plan.pages[0].id, "page-a");
  });
});

describe("reconcileSheets", () => {
  const pages = [
    { id: "page-a", page_number: 1, tenant_id: "tenant-1", document_id: "doc-1", project_id: "proj-1" },
    { id: "page-b", page_number: 2, tenant_id: "tenant-1", document_id: "doc-1", project_id: "proj-1" },
  ];

  it("inserts one sheet per page when none exist", () => {
    const plan = reconcileSheets({ existing: [], pages, pageCount: 2 });
    assert.equal(plan.inserts.length, 2);
    assert.equal(plan.inserts[0].document_page_id, "page-a");
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("leaves an already-linked sheet alone on retry", () => {
    const plan = reconcileSheets({
      existing: [
        { id: "sheet-1", document_page_id: "page-a", page_number: 1 },
        { id: "sheet-2", document_page_id: "page-b", page_number: 2 },
      ],
      pages,
      pageCount: 2,
    });
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.updates, []);
    assert.deepEqual(plan.deleteIds, []);
  });

  it("re-links a nulled sheet and deletes the duplicate orphan", () => {
    const plan = reconcileSheets({
      existing: [
        { id: "sheet-orphan", document_page_id: null, page_number: 1 },
        { id: "sheet-dup", document_page_id: null, page_number: 1 },
      ],
      pages: [pages[0]],
      pageCount: 1,
    });
    assert.deepEqual(plan.inserts, []);
    assert.deepEqual(plan.updates, [{ id: "sheet-dup", document_page_id: "page-a", page_number: 1 }]);
    assert.deepEqual(plan.deleteIds, ["sheet-orphan"]);
  });

  it("keeps later sheets when every existing page is in the plan", () => {
    const pagePlan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "done" },
        { id: "page-b", page_number: 2, status: "done", takeoff_status: "done" },
        { id: "page-c", page_number: 3, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [1],
      pageCount: 3,
      newId: ids("new"),
    });
    const sheetPlan = reconcileSheets({
      existing: [
        { id: "sheet-1", document_page_id: "page-a", page_number: 1 },
        { id: "sheet-2", document_page_id: "page-b", page_number: 2 },
        { id: "sheet-3", document_page_id: "page-c", page_number: 3 },
      ],
      pages: pagePlan.pages.map((page) => ({
        id: page.id,
        page_number: page.page_number,
        tenant_id: "tenant-1",
        document_id: "doc-1",
        project_id: "proj-1",
      })),
      pageCount: 3,
    });
    assert.equal(pagePlan.pages.find((page) => page.page_number === 3)?.insert, false);
    assert.deepEqual(sheetPlan.deleteIds, []);
    assert.deepEqual(sheetPlan.inserts, []);
  });

  it("deletes later sheets when those pages were missing from the loaded list", () => {
    const pagePlan = reconcileDocumentPages({
      ...base,
      existing: [
        { id: "page-a", page_number: 1, status: "done", takeoff_status: "done" },
      ],
      uploadedPageNumbers: [1],
      pageCount: 3,
      newId: ids("new"),
    });
    const sheetPlan = reconcileSheets({
      existing: [
        { id: "sheet-1", document_page_id: "page-a", page_number: 1 },
        { id: "sheet-2", document_page_id: "page-b", page_number: 2 },
        { id: "sheet-3", document_page_id: "page-c", page_number: 3 },
      ],
      pages: pagePlan.pages.map((page) => ({
        id: page.id,
        page_number: page.page_number,
        tenant_id: "tenant-1",
        document_id: "doc-1",
        project_id: "proj-1",
      })),
      pageCount: 3,
    });
    assert.equal(pagePlan.pages.length, 1);
    assert.deepEqual(sheetPlan.deleteIds, ["sheet-2", "sheet-3"]);
  });

  it("deletes sheets for pages removed from the pdf", () => {
    const plan = reconcileSheets({
      existing: [
        { id: "sheet-1", document_page_id: "page-a", page_number: 1 },
        { id: "sheet-3", document_page_id: null, page_number: 3 },
      ],
      pages: [pages[0]],
      pageCount: 1,
    });
    assert.deepEqual(plan.deleteIds, ["sheet-3"]);
    assert.deepEqual(plan.updates, []);
  });
});

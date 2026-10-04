import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { measurePdfBytes, saveMeasuredPages, type MeasuredPdfPage } from "./measure-pdf.ts";

describe("measure a printed sheet", () => {
  it("reads the scale off the page and measures the line in feet", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('SCALE: 1" = 20\'', { x: 72, y: 72, size: 12, font, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: 100, y: 400 }, end: { x: 244, y: 400 }, thickness: 1, color: rgb(0, 0, 0) });
    const bytes = await pdf.save();
    const [measured] = await measurePdfBytes(bytes);
    assert.match(measured.text, /1" = 20'/);
    assert.equal(measured.regions.length, 1);
    const line = measured.rows.find((row) => row.kind === "length" && Math.abs((row.quantity ?? 0) - 40) < 0.05);
    assert.ok(line, `expected a 40 ft line, got ${measured.rows.map((row) => row.quantity).join(",")}`);
  });
});

describe("save measured pages", () => {
  it("keeps machine geometry suggested and does not replace a decided row", async () => {
    const approvedPoints = [{ x: 100, y: 400 }, { x: 244, y: 400 }];
    const tables: Record<string, Array<Record<string, unknown>>> = {
      takeoff_items: [
        {
          id: "kept",
          document_id: "doc",
          tenant_id: "ten",
          source_method: "stated_scale",
          review_status: "approved",
          page: 1,
          type: "length",
          quantity: 40,
          points: approvedPoints,
        },
        {
          id: "stale",
          document_id: "doc",
          tenant_id: "ten",
          source_method: "stated_scale",
          review_status: "suggested",
          page: 1,
          type: "length",
          quantity: 10,
          points: [{ x: 0, y: 0 }, { x: 8, y: 0 }],
        },
      ],
      sheet_scale_regions: [],
      document_pages: [{ id: "page-1", tenant_id: "ten" }],
    };
    const inserted: Array<Record<string, unknown>> = [];

    function query(run: (filters: Array<(row: Record<string, unknown>) => boolean>) => { error: null; data: unknown }) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder = {
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        in(column: string, values: readonly unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        then(resolve: (value: { error: null; data: unknown }) => void, reject?: (reason: unknown) => void) {
          try {
            resolve(run(filters));
          } catch (err) {
            reject?.(err);
          }
        },
      };
      return builder;
    }

    const db = {
      from(table: string) {
        return {
          delete() {
            return query((filters) => {
              tables[table] = tables[table].filter((row) => !filters.every((fn) => fn(row)));
              return { error: null, data: null };
            });
          },
          update(patch: Record<string, unknown>) {
            return query((filters) => {
              tables[table] = tables[table].map((row) => (filters.every((fn) => fn(row)) ? { ...row, ...patch } : row));
              return { error: null, data: null };
            });
          },
          insert(rows: unknown) {
            const list = (Array.isArray(rows) ? rows : [rows]) as Array<Record<string, unknown>>;
            tables[table].push(...list);
            if (table === "takeoff_items") inserted.push(...list);
            return Promise.resolve({ error: null });
          },
          select() {
            return query((filters) => ({
              error: null,
              data: tables[table].filter((row) => filters.every((fn) => fn(row))),
            }));
          },
        };
      },
    };

    const measured: MeasuredPdfPage = {
      pageNumber: 1,
      pageWidth: 612,
      pageHeight: 792,
      text: "SCALE: 1\" = 20'",
      regions: [{
        scaleText: "1\" = 20'",
        pageSpaceScaleFactor: 20 / 72,
        bounds: { minX: 0, minY: 0, maxX: 612, maxY: 792 },
        coversPage: true,
        anchorX: 72,
        anchorY: 72,
        source: "stated_on_sheet",
        verified: false,
      }],
      rows: [
        {
          points: approvedPoints,
          closed: false,
          kind: "length",
          scaleText: "1\" = 20'",
          pageSpaceScaleFactor: 20 / 72,
          quantity: 40,
          unit: "LF",
          originMethod: "stated_scale",
          coordinateSystem: "page_space",
        },
        {
          points: [{ x: 10, y: 10 }, { x: 82, y: 10 }],
          closed: false,
          kind: "length",
          scaleText: "1\" = 20'",
          pageSpaceScaleFactor: 20 / 72,
          quantity: 20,
          unit: "LF",
          originMethod: "stated_scale",
          coordinateSystem: "page_space",
        },
      ],
    };

    await saveMeasuredPages(db as never, {
      tenantId: "ten",
      projectId: "proj",
      documentId: "doc",
      pages: [{ id: "page-1", pageNumber: 1, measured }],
    });

    assert.equal(tables.takeoff_items.some((row) => row.id === "kept" && row.review_status === "approved"), true);
    assert.equal(tables.takeoff_items.some((row) => row.id === "stale"), false);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].review_status, "suggested");
    assert.equal(inserted[0].quantity, 20);
    assert.equal(inserted.every((row) => row.review_status !== "approved"), true);
  });
});

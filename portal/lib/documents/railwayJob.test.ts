import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RAILWAY_EXTRACT_TIMEOUT_MS,
  interpretRailwayJob,
  rowsFromExtractResult,
} from "./railwayJob.ts";

const NOW = new Date("2026-10-03T12:00:00.000Z");

describe("rowsFromExtractResult", () => {
  it("reads Celery extract rows and ignores junk entries", () => {
    const parsed = rowsFromExtractResult({
      source_type: "dxf",
      rows: [
        { description: "Storm pipe", total_qty: 120.5, uom: "LF", cost_code: "33-40-00", trade: "Utilities" },
        "skip-me",
        { label: "Inlet", quantity: 2, unit: "EA" },
      ],
    });
    assert.equal(parsed?.sourceType, "dxf");
    assert.equal(parsed?.rows.length, 2);
    assert.equal(parsed?.rows[0].quantity, 120.5);
    assert.equal(parsed?.rows[0].unit, "LF");
    assert.equal(parsed?.rows[1].description, "Inlet");
    assert.equal(parsed?.rows[1].quantity, 2);
  });

  it("rejects a non-object payload", () => {
    assert.equal(rowsFromExtractResult(null), null);
    assert.equal(rowsFromExtractResult(["rows"]), null);
  });
});

describe("interpretRailwayJob", () => {
  it("imports a successful extract even when the row list is empty", () => {
    const decision = interpretRailwayJob(
      { status: "success", ready: true, successful: true, result: { source_type: "ifc", rows: [] } },
      "2026-10-03T11:00:00.000Z",
      NOW,
    );
    assert.equal(decision.action, "import");
    if (decision.action === "import") {
      assert.equal(decision.rows.length, 0);
      assert.equal(decision.sourceType, "ifc");
    }
  });

  it("fails when the worker reports failure", () => {
    const decision = interpretRailwayJob(
      { status: "failure", error: "ezdxf could not open file" },
      "2026-10-03T11:50:00.000Z",
      NOW,
    );
    assert.deepEqual(decision, { action: "fail", error: "ezdxf could not open file" });
  });

  it("waits while the job is still queued inside the timeout", () => {
    const decision = interpretRailwayJob(
      { status: "pending", ready: false, successful: null },
      new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(),
      NOW,
    );
    assert.equal(decision.action, "wait");
  });

  it("fails a job that never reports after the timeout", () => {
    const decision = interpretRailwayJob(
      { status: "started", ready: false },
      new Date(NOW.getTime() - RAILWAY_EXTRACT_TIMEOUT_MS - 1000).toISOString(),
      NOW,
    );
    assert.equal(decision.action, "fail");
    if (decision.action === "fail") {
      assert.match(decision.error, /timed out/i);
    }
  });

  it("does not treat a missing result on success as an empty takeoff", () => {
    const decision = interpretRailwayJob(
      { status: "SUCCESS", ready: true, successful: true, result: null },
      "2026-10-03T11:00:00.000Z",
      NOW,
    );
    assert.equal(decision.action, "fail");
  });
});

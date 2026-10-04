import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { takeoffFingerprint } from "./takeoff-import.ts";
import {
  allocateDirectCosts,
  blocksEstimateImport,
  pricingStatus,
  takeoffSyncFingerprint,
} from "../../supabase/functions/_shared/estimate-sync-contract.ts";

describe("estimate sync contract", () => {
  it("matches the takeoff fingerprint and allocates only a real split", () => {
    const fields = {
      label: "  Copper Pipe ",
      csi_code: "22-11-16",
      quantity: 142.5,
      unit: "LF",
      meta: { drawing_ref: "P2.1", location_tag: "Level 1" },
    };
    assert.equal(takeoffSyncFingerprint(fields), takeoffFingerprint(fields));

    assert.deepEqual(allocateDirectCosts(10, 48, null), {
      laborCost: 0,
      materialCost: 480,
      equipmentCost: 0,
    });
    assert.deepEqual(
      allocateDirectCosts(2, 1850, { labor: 650, material: 1100, equipment: 100 }),
      { laborCost: 1300, materialCost: 2200, equipmentCost: 200 },
    );
    assert.equal(pricingStatus(true, 48), "review");
    assert.equal(pricingStatus(false, 48), "priced");
    assert.equal(pricingStatus(false, null), "unpriced");
    assert.equal(blocksEstimateImport("suggested"), true);
    assert.equal(blocksEstimateImport("approved"), false);
  });

  it("queues portal estimate sync instead of inserting estimate lines", () => {
    const workerPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../supabase/functions/page-takeoff-worker/index.ts",
    );
    const source = readFileSync(workerPath, "utf8");
    assert.match(source, /enqueue_project_estimate_sync/);
    assert.match(source, /planPageTakeoffWrite/);
    assert.doesNotMatch(source, /from\("estimate_items"\)/);
    assert.doesNotMatch(source, /allocateDirectCosts/);
    assert.doesNotMatch(source, /function fingerprint\(/);
  });
});

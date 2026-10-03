import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateItemIdsOnMutableVersions, removeCivilMirrors } from "./civil-mirror.ts";

describe("estimateItemIdsOnMutableVersions", () => {
  it("drops draft and review lines and keeps approved snapshots", () => {
    const ids = estimateItemIdsOnMutableVersions(
      [
        { id: "draft-line", estimate_version_id: "v-draft" },
        { id: "review-line", estimate_version_id: "v-review" },
        { id: "approved-line", estimate_version_id: "v-approved" },
        { id: "void-line", estimate_version_id: "v-void" },
      ],
      [
        { id: "v-draft", status: "draft" },
        { id: "v-review", status: "review" },
        { id: "v-approved", status: "approved" },
        { id: "v-void", status: "void" },
      ],
    );
    assert.deepEqual(ids, ["draft-line", "review-line"]);
  });
});

describe("removeCivilMirrors", () => {
  it("deletes the mirrored takeoff rows and only the mutable estimate lines", async () => {
    const deleted: Record<string, string[]> = {};
    const db = {
      from(table: string) {
        const state: { op: "select" | "delete"; filters: Record<string, unknown> } = {
          op: "select",
          filters: {},
        };
        const builder: Record<string, unknown> = {
          select() { return builder; },
          eq(column: string, value: unknown) {
            state.filters[column] = value;
            return builder;
          },
          in(column: string, value: unknown) {
            state.filters[column] = value;
            return builder;
          },
          contains(column: string, value: unknown) {
            state.filters[column] = value;
            return builder;
          },
          delete() {
            state.op = "delete";
            return builder;
          },
          insert() {
            return Promise.resolve({ error: null });
          },
          then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
            return Promise.resolve(resultFor(table, state)).then(resolve, reject);
          },
        };
        return builder;
      },
    };

    function resultFor(
      table: string,
      state: { op: "select" | "delete"; filters: Record<string, unknown> },
    ): { data: unknown; error: null } {
      if (state.op === "delete") {
        const ids = state.filters.id;
        deleted[table] = Array.isArray(ids) ? ids as string[] : [];
        return { data: null, error: null };
      }
      if (table === "takeoff_items") {
        return {
          data: [
            { id: "t1", project_id: "p1", label: "pipe", quantity: 100, unit: "LF", csi_code: "33-30-00", meta: {} },
            { id: "t2", project_id: "p1", label: "trench", quantity: 12, unit: "CY", csi_code: "31-23-16", meta: {} },
          ],
          error: null,
        };
      }
      if (table === "estimate_items") {
        return {
          data: [
            { id: "e-draft", estimate_version_id: "v-draft" },
            { id: "e-approved", estimate_version_id: "v-approved" },
          ],
          error: null,
        };
      }
      if (table === "estimate_versions") {
        return {
          data: [
            { id: "v-draft", status: "draft" },
            { id: "v-approved", status: "approved" },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    }

    const result = await removeCivilMirrors(db, "tenant-1", {
      sourceTable: "civil_pipe_runs",
      sourceId: "run-1",
      projectId: "p1",
    }, "user-1");

    assert.deepEqual(result, { removedTakeoff: 2, removedEstimateLines: 1 });
    assert.deepEqual(deleted.estimate_items, ["e-draft"]);
    assert.deepEqual(deleted.takeoff_items, ["t1", "t2"]);
  });
});

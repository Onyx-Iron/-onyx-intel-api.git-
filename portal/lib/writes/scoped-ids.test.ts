import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateItemIdsOutsideVersion, takeoffIdsOutsideProject } from "./scoped-ids.ts";

describe("scoped id writes", () => {
  it("keeps a takeoff id that already belongs to this project", () => {
    const outside = takeoffIdsOutsideProject(
      [{ id: "here", tenant_id: "tenant-a", project_id: "project-a" }],
      "tenant-a",
      "project-a",
    );
    assert.deepEqual(outside, []);
  });

  it("rejects a takeoff id from another project or tenant", () => {
    const outside = takeoffIdsOutsideProject(
      [
        { id: "other-project", tenant_id: "tenant-a", project_id: "project-b" },
        { id: "other-tenant", tenant_id: "tenant-b", project_id: "project-a" },
        { id: "here", tenant_id: "tenant-a", project_id: "project-a" },
      ],
      "tenant-a",
      "project-a",
    );
    assert.deepEqual(outside, ["other-project", "other-tenant"]);
  });

  it("keeps an estimate line that already belongs to this version", () => {
    const outside = estimateItemIdsOutsideVersion(
      [{ id: "line", tenant_id: "tenant-a", estimate_version_id: "version-a" }],
      "tenant-a",
      "version-a",
    );
    assert.deepEqual(outside, []);
  });

  it("rejects an estimate line from another version or tenant", () => {
    const outside = estimateItemIdsOutsideVersion(
      [
        { id: "other-version", tenant_id: "tenant-a", estimate_version_id: "version-b" },
        { id: "other-tenant", tenant_id: "tenant-b", estimate_version_id: "version-a" },
        { id: "here", tenant_id: "tenant-a", estimate_version_id: "version-a" },
      ],
      "tenant-a",
      "version-a",
    );
    assert.deepEqual(outside, ["other-version", "other-tenant"]);
  });
});

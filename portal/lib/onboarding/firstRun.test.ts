import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  emptyFirstRun,
  firstRunHref,
  firstRunTargetId,
  isFirstRunComplete,
  mergeFirstRun,
  nextFirstRunStep,
  parseFirstRun,
} from "./firstRun.ts";
import { chooseOrCreateProjectHref } from "../navigation/project-sections.ts";

describe("first-run checklist", () => {
  it("parses missing or invalid storage as empty", () => {
    assert.deepEqual(parseFirstRun(null), emptyFirstRun());
    assert.deepEqual(parseFirstRun("not-json"), emptyFirstRun());
  });

  it("starts at create_project when the tenant has no jobs", () => {
    assert.equal(nextFirstRunStep(emptyFirstRun(), false), "create_project");
    assert.equal(firstRunHref("create_project", null), "/dashboard/projects?new=1");
    assert.equal(firstRunTargetId("create_project"), "new-project-button");
  });

  it("skips create when a project already exists", () => {
    assert.equal(nextFirstRunStep(emptyFirstRun(), true), "upload_plans");
    assert.equal(
      firstRunHref("upload_plans", "proj-1"),
      "/dashboard/projects/proj-1?phase=documents&tab=documents",
    );
  });

  it("advances to takeoff after plans are uploaded", () => {
    const flags = { ...emptyFirstRun(), project_created: true, plans_uploaded: true };
    assert.equal(nextFirstRunStep(flags, true), "open_takeoff");
    assert.equal(
      firstRunHref("open_takeoff", "proj-1"),
      "/dashboard/projects/proj-1?phase=takeoff&tab=takeoff",
    );
  });

  it("is complete after takeoff or when dismissed", () => {
    assert.equal(
      isFirstRunComplete({ ...emptyFirstRun(), dismissed: true }, false),
      true,
    );
    assert.equal(
      isFirstRunComplete({
        project_created: true,
        plans_uploaded: true,
        takeoff_opened: true,
        dismissed: false,
      }, true),
      true,
    );
  });

  it("OR-merges local and server checklist progress", () => {
    const local = { ...emptyFirstRun(), project_created: true };
    const remote = { ...emptyFirstRun(), plans_uploaded: true, takeoff_opened: true };
    assert.deepEqual(mergeFirstRun(local, remote), {
      project_created: true,
      plans_uploaded: true,
      takeoff_opened: true,
      dismissed: false,
    });
  });
});

describe("chooseOrCreateProjectHref", () => {
  it("opens the workspace when a project is selected", () => {
    assert.equal(
      chooseOrCreateProjectHref("proj-1", "documents", "documents"),
      "/dashboard/projects/proj-1?phase=documents&tab=documents",
    );
  });

  it("opens the create form when no project is selected", () => {
    assert.equal(chooseOrCreateProjectHref(null, "takeoff", "takeoff"), "/dashboard/projects?new=1");
  });
});

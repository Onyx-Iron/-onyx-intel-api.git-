import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isUniqueViolation, ownershipDenied, roleLookupFor } from "./route-guards.ts";

describe("roleLookupFor", () => {
  it("returns the org role only for the signed-in user", async () => {
    const lookup = await roleLookupFor("user_owner", async () => ({
      userId: "user_owner",
      orgId: "org_workspace",
      orgRole: "org:admin",
    }));
    assert.deepEqual(lookup, { orgId: "org_workspace", orgRole: "org:admin" });
  });

  it("drops the org role when the session belongs to someone else", async () => {
    const lookup = await roleLookupFor("user_other", async () => ({
      userId: "user_owner",
      orgId: "org_workspace",
      orgRole: "org:admin",
    }));
    assert.deepEqual(lookup, {});
  });

  it("drops the org role when Clerk fails", async () => {
    const lookup = await roleLookupFor("user_owner", async () => {
      throw new Error("clerk unavailable");
    });
    assert.deepEqual(lookup, {});
  });

  it("keeps a matching session that is not an org admin", async () => {
    const lookup = await roleLookupFor("user_member", async () => ({
      userId: "user_member",
      orgId: null,
      orgRole: null,
    }));
    assert.deepEqual(lookup, { orgId: null, orgRole: null });
  });
});

describe("ownershipDenied", () => {
  it("maps a cross-tenant ownership error to 403", async () => {
    const res = ownershipDenied(new Error("Project p1 does not belong to this tenant"));
    assert.ok(res);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Project p1 does not belong to this tenant" });
  });

  it("maps a thrown ownership string to 403", async () => {
    const res = ownershipDenied("Sheet 4 does not belong to this project");
    assert.ok(res);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Sheet 4 does not belong to this project" });
  });

  it("leaves unrelated failures for the caller", () => {
    assert.equal(ownershipDenied(new Error("Project not found")), null);
    assert.equal(ownershipDenied({}), null);
  });
});

describe("isUniqueViolation", () => {
  it("recognizes postgres unique failures and ignores other errors", () => {
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isUniqueViolation(undefined), false);
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation({ code: "23503", message: "foreign key" }), false);
    assert.equal(isUniqueViolation({ message: "duplicate key value violates unique constraint" }), true);
    assert.equal(isUniqueViolation({ message: "UNIQUE CONSTRAINT failed" }), true);
    assert.equal(isUniqueViolation({ message: "duplicate row" }), false);
  });
});

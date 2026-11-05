import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOperationalRole } from "./permissions.ts";
import { isUniqueViolation, ownershipDenied, roleLookupFromSession } from "./route-guards.ts";

const MEMBER = "user_member";
const ORG = "org_workspace";

describe("roleLookupFromSession", () => {
  it("forwards the org admin role only when the session is this user", () => {
    const lookup = roleLookupFromSession(MEMBER, {
      userId: MEMBER,
      orgId: ORG,
      orgRole: "org:admin",
    });
    assert.equal(resolveOperationalRole({
      storedRole: null,
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      ...lookup,
    }), "Owner");
  });

  it("drops another user's org admin role", () => {
    const lookup = roleLookupFromSession(MEMBER, {
      userId: "user_other",
      orgId: ORG,
      orgRole: "org:admin",
    });
    assert.deepEqual(lookup, {});
    assert.equal(resolveOperationalRole({
      storedRole: null,
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      ...lookup,
    }), "Estimator");
  });

  it("drops a signed-out session", () => {
    assert.deepEqual(roleLookupFromSession(MEMBER, {
      userId: null,
      orgId: ORG,
      orgRole: "org:admin",
    }), {});
  });
});

describe("ownershipDenied", () => {
  it("maps a cross-tenant ownership error to 403", async () => {
    const res = ownershipDenied(new Error("Project does not belong to this workspace"));
    assert.ok(res);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Project does not belong to this workspace" });
  });

  it("maps a thrown string the same way", async () => {
    const res = ownershipDenied("Page does not belong to project");
    assert.ok(res);
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Page does not belong to project" });
  });

  it("leaves unrelated failures for the caller", () => {
    assert.equal(ownershipDenied(new Error("permission denied")), null);
    assert.equal(ownershipDenied({ code: "23505" }), null);
  });
});

describe("isUniqueViolation", () => {
  it("recognizes postgres unique violations and their message text", () => {
    assert.equal(isUniqueViolation({ code: "23505" }), true);
    assert.equal(isUniqueViolation({ message: "duplicate key value violates unique constraint" }), true);
    assert.equal(isUniqueViolation({ message: "UNIQUE CONSTRAINT \"purchase_orders_bid_key\"" }), true);
  });

  it("does not treat other database errors as an existing purchase order", () => {
    assert.equal(isUniqueViolation(null), false);
    assert.equal(isUniqueViolation(undefined), false);
    assert.equal(isUniqueViolation({}), false);
    assert.equal(isUniqueViolation({ code: "23503", message: "insert or update violates foreign key constraint" }), false);
    assert.equal(isUniqueViolation({ message: "column \"total_amount\" does not exist" }), false);
  });
});

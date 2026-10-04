import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canPerform, resolveOperationalRole } from "./permissions.ts";

const MEMBER = "user_member";
const ORG = "org_workspace";

describe("resolveOperationalRole", () => {
  it("treats a Clerk org admin as Owner even with no profile row", () => {
    const role = resolveOperationalRole({
      storedRole: null,
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      orgId: ORG,
      orgRole: "org:admin",
    });
    assert.equal(role, "Owner");
    assert.equal(canPerform(role, "admin", "write"), true);
  });

  it("keeps the org admin as Owner when a lesser profile was stored", () => {
    const role = resolveOperationalRole({
      storedRole: "Estimator",
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      orgId: ORG,
      orgRole: "org:admin",
    });
    assert.equal(role, "Owner");
    assert.equal(canPerform(role, "admin", "write"), true);
    assert.equal(canPerform(role, "financial", "write"), true);
    assert.equal(canPerform(role, "field", "write"), true);
  });

  it("treats the personal workspace account as Owner", () => {
    const role = resolveOperationalRole({
      storedRole: null,
      clerkUserId: MEMBER,
      clerkOrgId: `user_${MEMBER}`,
    });
    assert.equal(role, "Owner");
    assert.equal(canPerform(role, "admin", "write"), true);
  });

  it("leaves an ordinary member as Estimator, who cannot delete a project", () => {
    const role = resolveOperationalRole({
      storedRole: null,
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      orgId: ORG,
      orgRole: "org:member",
    });
    assert.equal(role, "Estimator");
    assert.equal(canPerform(role, "admin", "write"), false);
    assert.equal(canPerform(role, "financial", "write"), true);
  });

  it("does not promote an admin of a different organization", () => {
    const role = resolveOperationalRole({
      storedRole: "ClientView",
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      orgId: "org_other",
      orgRole: "org:admin",
    });
    assert.equal(role, "ClientView");
    assert.equal(canPerform(role, "admin", "write"), false);
    assert.equal(canPerform(role, "financial", "read"), false);
    assert.equal(canPerform(role, "field", "write"), false);
  });

  it("keeps a stored Subcontractor from admin and financial access", () => {
    const role = resolveOperationalRole({
      storedRole: "Subcontractor",
      clerkUserId: MEMBER,
      clerkOrgId: ORG,
      orgId: ORG,
      orgRole: "org:member",
    });
    assert.equal(role, "Subcontractor");
    assert.equal(canPerform(role, "admin", "write"), false);
    assert.equal(canPerform(role, "financial", "read"), false);
    assert.equal(canPerform(role, "field", "write"), true);
  });
});

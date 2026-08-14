import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fallbackRoleForIdentity } from "./permissions";

describe("operational role bootstrap", () => {
  it("makes the authenticated personal-workspace user its owner", () => {
    assert.equal(fallbackRoleForIdentity({
      requestedUserId: "user-1",
      authenticatedUserId: "user-1",
      orgId: null,
      orgRole: null,
    }), "Owner");
  });

  it("maps organization admins to Admin and ordinary members to ClientView", () => {
    assert.equal(fallbackRoleForIdentity({
      requestedUserId: "user-1",
      authenticatedUserId: "user-1",
      orgId: "org-1",
      orgRole: "org:admin",
    }), "Admin");
    assert.equal(fallbackRoleForIdentity({
      requestedUserId: "user-2",
      authenticatedUserId: "user-2",
      orgId: "org-1",
      orgRole: "org:member",
    }), "ClientView");
  });

  it("fails closed when identity context is absent or belongs to another user", () => {
    assert.equal(fallbackRoleForIdentity({
      requestedUserId: "user-1",
      authenticatedUserId: null,
      orgId: null,
      orgRole: null,
    }), "ClientView");
    assert.equal(fallbackRoleForIdentity({
      requestedUserId: "user-1",
      authenticatedUserId: "user-2",
      orgId: null,
      orgRole: null,
    }), "ClientView");
  });
});

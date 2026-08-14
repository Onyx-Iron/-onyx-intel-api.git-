import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canPerform, fallbackRoleForIdentity } from "./permissions";

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

describe("resource permission matrix", () => {
  it("keeps financial and administrative writes restricted", () => {
    assert.equal(canPerform("Estimator", "financial", "write"), true);
    assert.equal(canPerform("FieldSuperintendent", "financial", "read"), false);
    assert.equal(canPerform("ProjectManager", "admin", "write"), false);
    assert.equal(canPerform("Admin", "admin", "write"), true);
  });

  it("allows field operators to write field records but keeps client viewers read-only", () => {
    assert.equal(canPerform("FieldSuperintendent", "field", "write"), true);
    assert.equal(canPerform("Subcontractor", "field", "write"), true);
    assert.equal(canPerform("ClientView", "field", "write"), false);
  });
});

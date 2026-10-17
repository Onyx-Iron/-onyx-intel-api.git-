import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { oauthCallbackStateMatchesSession } from "./oauthState.ts";

const session = { tenantId: "tenant-a", userId: "user-a", provider: "dropbox" };

describe("oauthCallbackStateMatchesSession", () => {
  it("accepts state that names the signed-in tenant, user, and provider", () => {
    assert.equal(
      oauthCallbackStateMatchesSession(
        { tenantId: "tenant-a", userId: "user-a", provider: "dropbox" },
        session,
      ),
      true,
    );
  });

  it("rejects state that would store this authorization code on another user", () => {
    assert.equal(
      oauthCallbackStateMatchesSession(
        { tenantId: "tenant-attacker", userId: "user-attacker", provider: "dropbox" },
        session,
      ),
      false,
    );
  });

  it("rejects a matching user id written onto a different tenant", () => {
    assert.equal(
      oauthCallbackStateMatchesSession(
        { tenantId: "tenant-b", userId: "user-a", provider: "dropbox" },
        session,
      ),
      false,
    );
  });

  it("rejects a different provider and incomplete state", () => {
    assert.equal(
      oauthCallbackStateMatchesSession(
        { tenantId: "tenant-a", userId: "user-a", provider: "meta" },
        session,
      ),
      false,
    );
    assert.equal(oauthCallbackStateMatchesSession({}, session), false);
    assert.equal(
      oauthCallbackStateMatchesSession(
        { tenantId: "", userId: "user-a", provider: "dropbox" },
        session,
      ),
      false,
    );
  });
});

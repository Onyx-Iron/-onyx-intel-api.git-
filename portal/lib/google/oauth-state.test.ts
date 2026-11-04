import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGoogleOAuthState,
  googleOAuthStateMatches,
  googleOAuthStateUserId,
} from "./oauth-state.ts";

describe("google OAuth state", () => {
  it("binds the callback to the nonce stored for this browser", () => {
    const state = createGoogleOAuthState("user_victim");
    assert.equal(googleOAuthStateUserId(state), "user_victim");
    assert.equal(googleOAuthStateMatches(state, state), true);
  });

  it("rejects a forged state that only copies the signed-in user id", () => {
    const started = createGoogleOAuthState("user_victim");
    const forged = "user_victim.attackercontrollednonce00";
    assert.equal(googleOAuthStateUserId(forged), "user_victim");
    assert.equal(googleOAuthStateMatches(started, forged), false);
    assert.equal(googleOAuthStateMatches(undefined, forged), false);
    assert.equal(googleOAuthStateMatches(started, ""), false);
  });
});

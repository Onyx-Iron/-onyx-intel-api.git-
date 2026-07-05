import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GOOGLE_SCOPE_LIST, GOOGLE_SCOPES } from "./scopes.ts";

describe("Google Workspace scopes", () => {
  it("covers Drive storage, Gmail read/send, Calendar read/write, Docs, and Sheets", () => {
    const actual = new Set<string>(GOOGLE_SCOPE_LIST);
    for (const scope of [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/documents",
    ]) {
      assert.ok(actual.has(scope), `missing ${scope}`);
    }
  });

  it("has no duplicates and exports the exact OAuth scope string", () => {
    assert.equal(new Set(GOOGLE_SCOPE_LIST).size, GOOGLE_SCOPE_LIST.length);
    assert.equal(GOOGLE_SCOPES, GOOGLE_SCOPE_LIST.join(" "));
  });
});

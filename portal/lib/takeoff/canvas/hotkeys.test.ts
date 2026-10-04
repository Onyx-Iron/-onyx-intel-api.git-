import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCanvasHotkey, isEditableKeyboardTarget } from "./hotkeys.ts";

function keyEvent(
  partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key" | "type">,
): Pick<KeyboardEvent, "key" | "code" | "type" | "repeat" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target"> {
  return {
    key: partial.key,
    code: partial.code ?? "",
    type: partial.type,
    repeat: partial.repeat ?? false,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    altKey: partial.altKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    target: partial.target ?? null,
  };
}

describe("resolveCanvasHotkey", () => {
  it("maps L/R/A/C to length/perimeter/area/count tools", () => {
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "l", type: "keydown" })), { type: "tool", tool: "length" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "r", type: "keydown" })), { type: "tool", tool: "perimeter" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "A", type: "keydown" })), { type: "tool", tool: "area" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "c", type: "keydown" })), { type: "tool", tool: "count" });
  });

  it("maps Escape/Enter/Z and Space hold", () => {
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "Escape", type: "keydown" })), { type: "cancel" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "Enter", type: "keydown" })), { type: "finish" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "z", type: "keydown" })), { type: "undo" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: " ", code: "Space", type: "keydown" })), { type: "pan_hold_start" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: " ", code: "Space", type: "keyup" })), { type: "pan_hold_end" });
  });

  it("maps Ctrl/Cmd undo redo select-all duplicate and delete", () => {
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "z", type: "keydown", ctrlKey: true })), { type: "undo" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "y", type: "keydown", metaKey: true })), { type: "redo" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "z", type: "keydown", ctrlKey: true, shiftKey: true })), { type: "redo" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "a", type: "keydown", ctrlKey: true })), { type: "select_all" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "d", type: "keydown", ctrlKey: true })), { type: "duplicate" });
    assert.deepEqual(resolveCanvasHotkey(keyEvent({ key: "Delete", type: "keydown" })), { type: "delete_selection" });
  });

  it("ignores repeats, alt, and unknown keys", () => {
    assert.equal(resolveCanvasHotkey(keyEvent({ key: "l", type: "keydown", repeat: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent({ key: "l", type: "keydown", altKey: true })), null);
    assert.equal(resolveCanvasHotkey(keyEvent({ key: "q", type: "keydown" })), null);
  });

  it("ignores events from editable fields", () => {
    const fakeInput = {
      tagName: "INPUT",
      isContentEditable: false,
      closest: () => null,
    } as unknown as EventTarget;
    assert.equal(isEditableKeyboardTarget(fakeInput), true);
    assert.equal(
      resolveCanvasHotkey(keyEvent({ key: "l", type: "keydown", target: fakeInput })),
      null,
    );
  });
});

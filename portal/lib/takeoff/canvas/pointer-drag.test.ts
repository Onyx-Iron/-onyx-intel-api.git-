import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { attachPointerDrag, type DragListenerTarget } from "./pointer-drag.ts";

function mockTarget(): DragListenerTarget & { emit(type: "mousemove" | "mouseup"): void } {
  const listeners = new Map<string, Set<(event: MouseEvent) => void>>();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type } as MouseEvent);
    },
  };
}

describe("attachPointerDrag", () => {
  it("forgets the previous mouseup when a drag effect re-subscribes", () => {
    const target = mockTarget();
    const calls: string[] = [];
    const stopFirst = attachPointerDrag(
      target,
      () => calls.push("move-1"),
      () => calls.push("up-1"),
    );
    stopFirst();
    attachPointerDrag(
      target,
      () => calls.push("move-2"),
      () => calls.push("up-2"),
    );

    target.emit("mouseup");

    assert.deepEqual(calls, ["up-2"]);
  });
});

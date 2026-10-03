import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CommandStack } from "./command-stack.ts";

describe("CommandStack", () => {
  it("undo/redo reverses mutations", async () => {
    let value = 0;
    const stack = new CommandStack();
    await stack.push({
      id: "1",
      label: "inc",
      redo: () => { value += 1; },
      undo: () => { value -= 1; },
    });
    assert.equal(value, 1);
    assert.equal(stack.canUndo, true);
    await stack.undo();
    assert.equal(value, 0);
    assert.equal(stack.canRedo, true);
    await stack.redo();
    assert.equal(value, 1);
  });
});

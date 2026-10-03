import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canvasChannelName,
  peersFromPresenceState,
  peerColorForKey,
  removeByKey,
  upsertByKey,
} from "./canvas-realtime";

describe("canvas-realtime helpers", () => {
  it("builds a scoped channel name", () => {
    assert.equal(canvasChannelName("proj-1", "page-9"), "canvas:proj-1:page-9");
  });

  it("upserts and removes by key", () => {
    const a = [{ key: "a", n: 1 }, { key: "b", n: 2 }];
    const upserted = upsertByKey(a, { key: "a", n: 9 });
    assert.equal(upserted.find((x) => x.key === "a")?.n, 9);
    assert.equal(upserted.length, 2);
    const removed = removeByKey(upserted, "b");
    assert.deepEqual(removed.map((x) => x.key), ["a"]);
  });

  it("assigns a stable peer color", () => {
    const c1 = peerColorForKey("user-abc");
    const c2 = peerColorForKey("user-abc");
    assert.equal(c1, c2);
    assert.match(c1, /^#/);
  });

  it("flattens presence state excluding self", () => {
    const peers = peersFromPresenceState(
      {
        self: { metas: [{ name: "Me", color: "#fff" }] },
        peer1: { metas: [{ name: "Alex", color: "#CCFF00", x: 10, y: 20 }] },
      },
      "self",
    );
    assert.equal(peers.length, 1);
    assert.equal(peers[0]?.name, "Alex");
    assert.equal(peers[0]?.x, 10);
  });
});

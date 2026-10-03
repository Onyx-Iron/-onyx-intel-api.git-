/**
 * Web Worker: off-main-thread magnetic snap for SheetCanvas mousemove.
 */

import {
  DEFAULT_SNAP_THRESHOLD_PX,
  getNearestVectorPoint,
  type SnapResult,
  type VectorPoint,
} from "@/lib/takeoff/canvas/snap-algorithm";

let cachedSnapPoints: VectorPoint[] = [];

type SetPointsMessage = { type: "set-points"; vectorPoints: VectorPoint[] };
type SnapMessage = {
  type: "snap";
  id: number;
  cursor: VectorPoint;
  thresholdPixels?: number;
};
type InboundMessage = SetPointsMessage | SnapMessage;

type SnapResponse = { type: "snap-result"; id: number; result: SnapResult };

self.onmessage = (event: MessageEvent<InboundMessage>) => {
  const msg = event.data;
  if (msg.type === "set-points") {
    cachedSnapPoints = Array.isArray(msg.vectorPoints) ? msg.vectorPoints : [];
    return;
  }

  if (msg.type === "snap") {
    const result = getNearestVectorPoint(
      msg.cursor,
      cachedSnapPoints,
      msg.thresholdPixels ?? DEFAULT_SNAP_THRESHOLD_PX,
    );
    const response: SnapResponse = { type: "snap-result", id: msg.id, result };
    self.postMessage(response);
  }
};

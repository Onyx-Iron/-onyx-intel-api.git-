type DragListener = (event: MouseEvent) => void;

export interface DragListenerTarget {
  addEventListener(type: "mousemove" | "mouseup", listener: DragListener): void;
  removeEventListener(type: "mousemove" | "mouseup", listener: DragListener): void;
}

/**
 * Subscribe to a pointer drag. The returned function removes both the move
 * and the up listener.
 *
 * Sheet drag effects re-run on every move because the commit callback closes
 * over the latest geometry. A mouseup left registered with `{ once: true }`
 * is not removed by that re-run, so release fires every earlier listener.
 * The first one still holds the pre-drag row version and saves an
 * intermediate point; the listener for the drop position then conflicts.
 */
export function attachPointerDrag(
  target: DragListenerTarget,
  onMove: DragListener,
  onUp: DragListener,
): () => void {
  target.addEventListener("mousemove", onMove);
  target.addEventListener("mouseup", onUp);
  return () => {
    target.removeEventListener("mousemove", onMove);
    target.removeEventListener("mouseup", onUp);
  };
}

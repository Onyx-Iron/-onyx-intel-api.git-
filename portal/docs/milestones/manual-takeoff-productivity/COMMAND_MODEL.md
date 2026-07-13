# Command Model

**Undo/redo itself was not built this milestone** (deferred per scope decision — see `TARGET_INTERACTION_MODEL.md`). This document records the one command-like unit that WAS implemented, so a future undo/redo pass has a real precedent to generalize from rather than starting blind.

## The one implemented "command": drag-to-move

- **Begin**: `beginShapeDrag(e, s)` captures `{ key, startClient, originalPoints, originalRowVersion }` — this is the "before state."
- **During**: `mousemove` updates only the in-memory `points` field of the one shape being dragged. No other state changes, no network call.
- **Commit**: `mouseup` → `commitShapeDrag` — one PATCH call carrying the ORIGINAL `row_version` (not a live-tracked one), so a version bumped by someone else mid-drag is still correctly detected as stale. This is "one drag = one command/one write," matching STEP 5's rule directly.
- **Failure**: a non-conflict failure reverts local `points` to `originalPoints` — the "after state" only exists once the server confirms it; a failed PATCH never leaves stale/incorrect state.
- **Conflict**: the structured 409 response is handled explicitly (see `CONFLICT_MODEL.md`) rather than silently retried or overwritten.

## What a future undo/redo layer would need to generalize
- A command type per drag interaction (`move`) plus, once built: `create`, `resize`, `vertex_add/remove/move`, `property_edit`, `batch_edit`, `duplicate`, `paste`, `layer_change`, `lock/unlock`, `soft_delete`, `restore` — each needs its own before/after capture, exactly as `dragState`/`commitShapeDrag` already demonstrate for `move`.
- A session-scoped stack (array of committed commands with before/after + timestamp + persistence status), Ctrl/Cmd+Z / Shift+Z wired to pop/push it, calling the SAME PATCH/POST/DELETE endpoints already built (`update_manual_takeoff_tx`, `save_manual_takeoff_tx`, `soft_delete_manual_takeoff_tx`) so undo/redo never bypasses server-side validation, conflict detection, or the atomic-write guarantee.
- A practical history-size cap (e.g. last 50 commands) and the same "approved estimate versions remain immutable" constraint the write RPCs already enforce independent of any client-side history.

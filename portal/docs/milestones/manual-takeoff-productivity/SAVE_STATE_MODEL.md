# Save State Model

## What exists after this milestone
- Per-`Shape` `saved?: boolean` (unchanged from before).
- Drag-to-move: local optimistic update while dragging, one PATCH on `mouseup`, revert-on-failure, structured conflict handling (see `CONFLICT_MODEL.md`).
- PATCH/POST responses carry `discrepancy_warning` (submitted vs. server-calculated quantity) and `calibration_warning` (unverified/legacy calibration blocking estimate-sync) — already returned by the API from the prior milestone, not newly surfaced in the UI this pass.

## Not built this milestone (deferred)
A consolidated, always-visible save/conflict/estimate-sync status indicator (`Clean / Dirty / Saving / Saved / Failed / Conflict / Estimate sync pending / failed / complete`) was not implemented as UI. The states themselves are largely already distinguishable from API responses (`ok`, `conflict`, `discrepancy_warning`, `calibration_warning`, `outbox_processed`), but no unified visual component consumes them yet.

Also not built: a beforeunload warning for unsaved work, and debounced property-change saving (property edits go through the existing `updateCostCode`-style pattern, unchanged).

## What IS guaranteed regardless of UI
- "Saved" is never claimed before server confirmation — `saved: true` is only set in local state inside a `res.ok` branch, never optimistically before the request resolves (this was already true before this milestone and remains true for the new PATCH path).
- A failed write (409 or 5xx) reverts to the pre-drag position rather than leaving an ambiguous or corrupted local state.
- All writes go through the existing atomic RPCs (`save_manual_takeoff_tx`, `update_manual_takeoff_tx`, `soft_delete_manual_takeoff_tx`) — no direct-table writes were added anywhere in the client or route layer.

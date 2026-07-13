# Remaining Risks

1. **No scheduled outbox re-driver.** The worker is fully built and proven (claim/backoff/dead-letter), but nothing periodically calls `POST /api/internal/outbox/process` yet — it only runs opportunistically after a save/update/delete on the SAME or a related object. An event for an object nobody touches again could sit `pending`/`failed` indefinitely. Wiring the documented `pg_cron` + `pg_net` trigger (see `OUTBOX_WORKER.md`) requires a deployed app URL and a Vault secret — environment-specific setup left to the user.

2. **No restore RPC.** Soft-deleted `manual_takeoffs` rows have no application-level path back to active — only `deleted_at` exists, set by `soft_delete_manual_takeoff_tx`, with nothing symmetric to clear it. A `restore_manual_takeoff_tx` (re-creating the mirror, writing a `restored` history action, re-queuing an `upsert` outbox event) is a reasonably small follow-up given the existing pattern.

3. **Vertex-level and multi-object geometry editing is not built.** Only whole-object translation (move) for `count`/`length`/`area` shapes exists. Per-vertex add/remove/move for polylines/polygons, rectangle resize handles, multi-point count dragging, and dragging for utility runs/topo nodes/area bounds all still require delete-and-redraw. The `beginShapeDrag`/`commitShapeDrag` pattern generalizes reasonably directly to these, but each needs its own hit-testing and handle UI.

4. **The conflict UI is minimal (`window.confirm`).** It satisfies the two required actions (reload server / discard local) but blocks the whole page and offers no diff view, no "save as new object," and no "retry after review." A real modal is a follow-up.

5. **Everything from the original 20-section spec not covered by "Reliability + core editing"** — multi-select, layers, copy/paste, undo/redo, keyboard shortcuts, toolbar refinement, the quantity-summary panel, and a dedicated estimate-link-state UI — remains unbuilt. See `TARGET_INTERACTION_MODEL.md` for the explicit boundary.

6. **Performance at scale is untested** (100/500/2,000/5,000 objects) — see `PERFORMANCE_RESULTS.md`. The features that would actually stress render/selection/summary performance (multi-select, layers, the summary panel) don't exist yet, so a benchmark now would only measure the unchanged parts of the canvas.

7. **The reconciliation query in `reconcileDeletedTakeoffEstimateItems` scans `takeoff_item_history` filtered by a JSONB `.contains()` match on `before.source_manual_takeoff_id`.** This is correct but has no dedicated index on that JSONB path — fine at current data volumes, worth revisiting if `takeoff_item_history` grows very large per tenant.

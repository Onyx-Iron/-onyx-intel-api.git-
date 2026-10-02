# Remaining Risks

1. **~~No scheduled outbox re-driver.~~ Mitigated.** Vercel Cron hits `GET/POST /api/internal/outbox/process` every 5 minutes (`portal/vercel.json`), authenticated via `CRON_SECRET` (or `INTERNAL_WORKER_SECRET` for pg_net callers). Ensure `CRON_SECRET` is set in the Vercel project env. Optional pg_cron + pg_net remains documented in `OUTBOX_WORKER.md` for self-hosted setups.

2. **~~No restore RPC.~~ Mitigated.** `restore_manual_takeoff_tx` (migration `20261002_restore_manual_takeoff_and_outbox_notes.sql`) clears `deleted_at`, recreates the takeoff_items mirror, writes a `restored` history action, and enqueues an `upsert` outbox event. Wired via `PUT /api/takeoff/canvas/manual` with `{ id }`.

3. **Vertex-level and multi-object geometry editing is not built.** Only whole-object translation (move) for `count`/`length`/`area` shapes exists. Per-vertex add/remove/move for polylines/polygons, rectangle resize handles, multi-point count dragging, and dragging for utility runs/topo nodes/area bounds all still require delete-and-redraw. The `beginShapeDrag`/`commitShapeDrag` pattern generalizes reasonably directly to these, but each needs its own hit-testing and handle UI.

4. **The conflict UI is minimal (`window.confirm`).** It satisfies the two required actions (reload server / discard local) but blocks the whole page and offers no diff view, no "save as new object," and no "retry after review." A real modal is a follow-up.

5. **Everything from the original 20-section spec not covered by "Reliability + core editing"** — multi-select, layers, copy/paste, undo/redo, keyboard shortcuts, toolbar refinement, the quantity-summary panel, and a dedicated estimate-link-state UI — remains unbuilt. See `TARGET_INTERACTION_MODEL.md` for the explicit boundary.

6. **Performance at scale is untested** (100/500/2,000/5,000 objects) — see `PERFORMANCE_RESULTS.md`. The features that would actually stress render/selection/summary performance (multi-select, layers, the summary panel) don't exist yet, so a benchmark now would only measure the unchanged parts of the canvas.

7. **The reconciliation query in `reconcileDeletedTakeoffEstimateItems` scans `takeoff_item_history` filtered by a JSONB `.contains()` match on `before.source_manual_takeoff_id`.** This is correct but has no dedicated index on that JSONB path — fine at current data volumes, worth revisiting if `takeoff_item_history` grows very large per tenant.

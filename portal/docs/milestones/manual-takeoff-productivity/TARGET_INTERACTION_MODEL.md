# Target Interaction Model (this milestone's actual scope)

Per the "Reliability + core editing" scope decision: this milestone builds the outbox worker and basic geometry editing + optimistic concurrency. Multi-select, layers, copy/paste, undo/redo, keyboard shortcuts beyond existing Escape/Enter, and the quantity-summary UI are explicitly deferred — see `REMAINING_RISKS.md`.

## What was built

**Whole-object drag-to-move** for already-saved `Shape` objects (count/length/area) when the `pan` tool is active:
- `onMouseDown` on a saved, selected-or-selectable shape starts a drag (`dragState`).
- `mousemove` updates the shape's points **locally only** (optimistic, in display space, converted back to storage space) — no network call per pointer-move event.
- `mouseup` commits once, via `PATCH /api/takeoff/canvas/manual`, carrying the `row_version` last read from the server.
- Translation never changes length/area/count, so no quantity recompute is needed mid-drag — only geometry moves; the server still recalculates the authoritative quantity from the new geometry on commit (same server-validation path as POST).

**Optimistic concurrency**: every `manual_takeoffs` row carries `row_version`. The PATCH path (`update_manual_takeoff_tx`) only applies a change if the submitted `row_version` still matches the stored one; a mismatch returns a structured `409 { conflict: true, server_state }`, never a silent overwrite. The client's conflict UI offers the two required minimum actions — reload the server's version, or keep the local (unsaved) change — via a blocking `window.confirm`. A fuller side-by-side diff modal with "save as new object" / "retry after review" is deferred.

**Deferred within "geometry editing"**: per-vertex add/remove/move for polyline/polygon, rectangle resize handles, multi-point count dragging, and dragging for utility runs/topo nodes/area bounds. Only whole-object translation for the three core `Shape` tools was built — see `REMAINING_RISKS.md` for why and what a follow-up would need.

## What was NOT built (explicitly out of scope this pass)
- Multi-select (shift/ctrl-click, marquee, select-by-layer/type/cost-code/status)
- Command-based undo/redo
- Copy/paste/duplicate
- A consolidated properties panel (single or batch)
- Layers (table, UI, assignment)
- New keyboard shortcuts (V/H/L/P/A/R/C/S/arrow-nudge/etc.)
- Toolbar refinement beyond what already existed
- The quantity-summary panel
- Estimate-link state UI (beyond the raw fields the API already returns)

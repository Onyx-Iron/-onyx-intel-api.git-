# Current Interaction Model (audit, before this milestone)

## Selection
Single-select only: `const [selectedKey, setSelectedKey] = useState<string | null>(null)`. No multi-select, no shift/ctrl-click, no marquee, no select-by-layer/type/cost-code/status (layers didn't exist at all).

## Geometry editing
None. Once a shape (count/length/area/utility run/topo node/area bound) was committed, its geometry was immutable — the only way to change it was delete-and-redraw. No move, resize, or vertex editing existed for any already-saved object.

## Undo/redo
None. No command history of any kind.

## Copy/paste/duplicate
None.

## Properties panel
Per-item inline controls only (a cost-code input rendered in the right-hand dock list for each shape/run/node/bound) — no single consolidated panel, no batch editing across a selection.

## Save state
A single global `saving: boolean` plus a per-item `saved?: boolean` flag. No distinguishing dirty/saving/failed/conflict states, no per-item error surfacing beyond a blocking `alert()` on total failure.

## Layers
None — every object belongs to one flat list per type (shapes/utilityRuns/topoNodes/areaBounds), filterable only by which drawing tool created it.

## Keyboard shortcuts
Escape (cancel current draft/selection) and Enter (commit current draft) only, wired via a single `window.addEventListener("keydown", ...)` in one `useEffect`.

## Atomic RPCs / outbox (inherited from the prior milestone, unchanged by this audit)
`save_manual_takeoff_tx`, `soft_delete_manual_takeoff_tx` — atomic per-object write, but the estimate-sync outbox had no claim mechanism, no backoff, no dead-letter state, and no reconciliation for takeoffs already priced into an **approved** estimate (see `IMPLEMENTATION_SUMMARY.md` for the real bug this exposed).

## Findings that shaped scope
- No duplicate selection/property-edit logic existed to consolidate (there was no selection/property system yet) — this milestone is additive, not a refactor.
- Direct-database-writes-during-pointer-movement was not a risk yet (no dragging existed) but had to be designed out from the start of the new drag feature — hence translation-only local optimistic updates with a single PATCH on drag-end, never on `mousemove`.
- The manual-takeoff canvas UI (`SheetCanvas.tsx`) is a single ~1600-line component; no dead components were found to remove.

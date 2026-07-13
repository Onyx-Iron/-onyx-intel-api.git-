# Acceptance Results

Scope was explicitly narrowed by user decision to "Reliability + core editing": the outbox worker and basic geometry editing + optimistic concurrency. The definition of done below is evaluated against that agreed scope, not the full 20-section spec.

| Definition-of-done item | Status | Evidence |
|---|---|---|
| Selection works | Unchanged (single-select only, pre-existing) | Out of scope this pass — see `TARGET_INTERACTION_MODEL.md` |
| Core geometry editing works | ✅ (whole-object move only) | Drag-to-move for count/length/area; per-vertex/resize deferred |
| Undo and redo work | ❌ Deferred | `COMMAND_MODEL.md` |
| Copy/paste and duplicate create safe records | ❌ Deferred | — |
| Properties panel supports single and batch edits | Unchanged (per-item inline only) | Deferred |
| Save and conflict states are accurate | ✅ (conflict) / partial (visual states) | `CONFLICT_MODEL.md`, `SAVE_STATE_MODEL.md` |
| Soft delete and restore work | ✅ soft delete (pre-existing + hardened) / ❌ restore RPC not added | See below |
| Layers work | ❌ Deferred | `LAYER_MODEL.md` |
| Keyboard shortcuts work | Unchanged (Escape/Enter only) | Deferred |
| Quantity summary reconciles | ❌ Deferred (panel doesn't exist) | — |
| Estimate-link states are visible | Partial (API returns them; no dedicated UI) | `SAVE_STATE_MODEL.md` |
| Outbox events retry automatically | ✅ | `OUTBOX_WORKER.md` — claim/backoff/dead-letter proven live |
| Failed events cannot remain pending indefinitely | ✅ within a batch's own attempts / ⚠ no scheduled sweep yet | `REMAINING_RISKS.md` |
| Draft estimates reconcile correctly | ✅ | delete-reconciliation test |
| Approved versions remain immutable | ✅ | proven exactly by the bug this milestone found and fixed |
| Cross-tenant access is denied | ✅ | RPC-level cross-tenant retry-delete test |
| Tests pass | ✅ 70/70 | `TEST_PLAN.md` |
| Production build passes | ✅ | clean `next build` |
| Performance is measured | ❌ Not measured | `PERFORMANCE_RESULTS.md` — stated honestly, not fabricated |
| Adversarial review finds no critical defect | ✅ (within built scope) | see below |

## Restore RPC
Not added as a separate RPC this pass — `manual_takeoffs.deleted_at` (from the prior milestone) remains the only soft-delete mechanism, and there is no `restore_manual_takeoff_tx`. A soft-deleted row can only be un-deleted today by a direct database operation, not through the app. Flagged in `REMAINING_RISKS.md`.

## Adversarial review findings
- **Geometry corruption**: none found — drag reverts cleanly on failure; storage-space conversion mirrors the already-proven `toDisplayPoints`/`toPersistedPoints` pattern.
- **Incorrect undo/duplicate redo**: not applicable (not built).
- **Stale overwrite**: closed by `row_version` + the structured-conflict RPC design, proven live.
- **Lost local edits**: a failed PATCH reverts to the last-known-good position rather than leaving ambiguous state; a conflict's "keep local" path deliberately preserves the unsaved position for a retry.
- **Partial batch edits**: not applicable (no batch editing built).
- **Layer-lock bypass**: not applicable (no layers built).
- **Wrong summary totals**: not applicable (no summary built).
- **Duplicate outbox processing**: prevented by `FOR UPDATE SKIP LOCKED` claim semantics, proven via a concurrent-claim-style test.
- **Permanent pending sync**: proven wrong in the ORIGINAL design (the approved-version delete bug) and fixed; the remaining "no scheduled sweep" gap is different — it's about staleness, not permanence, since any future save/update on the same object re-triggers processing.
- **Approved estimate mutation**: this is exactly the class of bug found and fixed this milestone (see `IMPLEMENTATION_SUMMARY.md`) — now proven correct live, not just assumed.
- **Cross-tenant access**: proven denied at the RPC layer.
- **Performance collapse**: not evaluated — see `PERFORMANCE_RESULTS.md`.

No unresolved critical geometry, transaction, conflict, outbox, or authorization defect was found within what was actually built. The features explicitly deferred (selection, layers, undo/redo, etc.) are scope boundaries, not defects.

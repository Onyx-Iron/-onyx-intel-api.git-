# Implementation Summary

## Migrations (applied live, in order)
1. `20260810_productivity_row_version_and_outbox_worker.sql` — `manual_takeoffs.row_version`; outbox `claimed_at/claimed_by/next_attempt_at` + expanded status enum + reworked dedup index; `update_manual_takeoff_tx`, `claim_outbox_events`, `complete_outbox_event`, `fail_outbox_event`, `retry_outbox_event`; re-issued `save_manual_takeoff_tx`/`soft_delete_manual_takeoff_tx` to match the new outbox dedup index and to bump `row_version` on upsert-path updates.
2. `20260811_soft_delete_locked_estimate_fix.sql` — fixes a real bug found by live testing (below).

## Application changes
- `lib/estimating/outbox-worker.ts` (new) — `processOutboxBatch`, `reconcileDeletedTakeoffEstimateItems`, injectable `syncFn` for testability.
- `app/api/internal/outbox/process/route.ts` (new) — shared-secret server-to-server trigger.
- `app/api/internal/outbox/retry/route.ts` (new) — user-facing manual retry for dead-lettered events.
- `app/api/takeoff/canvas/manual/route.ts` — POST/DELETE now call `processOutboxBatch` (replacing the prior milestone's ad hoc inline sync-and-mark-processed logic) instead of duplicating outbox handling; new `PATCH` handler (`update_manual_takeoff_tx` + server-side quantity recalculation, matching POST's existing validation).
- `components/takeoff/canvas/SheetCanvas.tsx` — `Shape` gained `id`/`row_version`; whole-object drag-to-move for saved count/length/area shapes with optimistic local update, single PATCH on drag-end, and conflict handling.

## Real bugs found and fixed during this milestone (not hypothetical)
1. **Production-blocking**: deleting any manual takeoff whose mirror had already been priced into an **approved** estimate version failed outright. Root cause: `estimate_items.source_takeoff_id` has `ON DELETE SET NULL`; hard-deleting the mirror (as `soft_delete_manual_takeoff_tx` always did) triggered an FK-cascaded UPDATE on the linked `estimate_items` row, which tripped the pre-existing `prevent_locked_estimate_item_write` trigger and rolled back the entire delete. Caught by the live-database "left completely untouched when APPROVED" test before this ever reached the app route. Fixed by checking for locked-version references before hard-deleting the mirror — if any exist, the mirror is retained (audited as `updated`, not `deleted`) instead of removed, since removing it would itself mutate the locked estimate line.
2. A test-isolation issue (not a product bug) surfaced the same class of finding twice while debugging #1: multiple tests sharing one project/estimate lineage interfered with each other's draft/approved version state — fixed by giving each estimate-sync-sensitive test its own isolated project.

## Explicitly deferred (see `REMAINING_RISKS.md`)
Multi-select, layers, copy/paste, undo/redo, keyboard shortcuts beyond Escape/Enter, the quantity-summary panel, per-vertex geometry editing, a live pg_cron trigger for the outbox worker (the worker itself is fully built and tested; only the periodic schedule needs environment-specific setup).

# Test Plan

## Unit tests (pre-existing, re-run unchanged)
`lib/takeoff/canvas/coordinates.test.ts` (14), `lib/takeoff/canvas/quantity.test.ts` (22) — confirm the schema/outbox changes this milestone made didn't regress geometry/quantity correctness.

## Live-database integration tests (pre-existing, re-run unchanged)
`lib/takeoff/manual-canvas-persistence.integration.test.ts` (17), `lib/takeoff/calibration-and-atomic-writes.integration.test.ts` (11) — confirm the new `row_version` column, the outbox schema migration, and the `save_manual_takeoff_tx` signature change (adding `p_document_id`) didn't break any previously-proven guarantee.

## Live-database integration tests (new — `lib/estimating/outbox-worker.integration.test.ts`, 6 tests)
- **Calibration invariance / upsert events**: `processOutboxBatch` claims a pending event, actually drives `syncTakeoffToEstimate` (via injected `syncFn`), and marks it processed; re-processing an already-processed event is a no-op (relies on `syncTakeoffToEstimate`'s own fingerprint dedup).
- **Delete reconciliation**: a soft-deleted takeoff's synced `estimate_items` row is removed when its version is still draft; left **completely untouched** when the version is approved (this is the test that caught the real FK-cascade bug — see `IMPLEMENTATION_SUMMARY.md`).
- **Optimistic concurrency**: correct `row_version` succeeds and increments it; stale `row_version` returns a structured conflict without applying the change or corrupting the stored quantity; history alternates `created → updated`, never a duplicate `created`.

## Live smoke tests (ad hoc, via `execute_sql`, not committed files)
Ran `save_manual_takeoff_tx` / `update_manual_takeoff_tx` / `claim_outbox_events` / `complete_outbox_event` / `fail_outbox_event` / `retry_outbox_event` directly in `DO` blocks before wiring any application code — this is how the exponential-backoff/dead-letter transitions and the cross-tenant retry denial were proven correct cheaply, and how the `document_id` FK bug from the prior milestone's pattern would have been caught again if reintroduced.

## What was deliberately NOT built as separate tests (scope-consistent, not a gap)
Selection (single/multi/marquee/hidden/locked), full copy/paste, layer CRUD, and the quantity-summary tests from the original spec were not written — the corresponding features don't exist this milestone (see `TARGET_INTERACTION_MODEL.md`). Writing tests for unbuilt features would be theater, not coverage.

## Component/UI tests
None added — `SheetCanvas.tsx` has no existing component-test harness in this codebase to extend, and standing one up for a single drag interaction was judged lower value than the live-database coverage above, which is where this milestone's real risk (transaction/conflict/outbox correctness) actually lives.

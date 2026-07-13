# Test Plan

## Unit tests

- `lib/takeoff/canvas/quantity.test.ts` (22 tests) — every formula, waste/multiplier, unit conversion, and an explicit render-scale-invariance proof at the quantity layer.
- `lib/takeoff/canvas/coordinates.test.ts` (14 tests, pre-existing, unchanged) — page-space transform correctness.

## Live-database integration tests

- `lib/takeoff/manual-canvas-persistence.integration.test.ts` (17 tests, pre-existing, re-run unchanged — confirms the calibration/atomic-write changes didn't regress the previously-proven persistence guarantees).
- `lib/takeoff/calibration-and-atomic-writes.integration.test.ts` (11 tests, new) — calls the real `save_manual_takeoff_tx` / `soft_delete_manual_takeoff_tx` RPCs directly:
  - **Calibration invariance**: identical page-space geometry across 7 simulated render scales (0.5x–2.4x, fit-width/fit-page stand-ins) produces identical quantities; area and count likewise.
  - **Transaction correctness**: a forced invalid-`takeoff_type` failure leaves zero rows in `manual_takeoffs`/history/mirror/outbox; attempting to resurrect a soft-deleted `client_key` is rejected outright with no partial effect.
  - **Idempotency**: same `client_key` twice → one row, one mirror, `created`+`updated` history (not two `created`s), one deduped pending outbox row; concurrent identical saves don't race into two rows.
  - **Delete consistency**: soft-delete hard-deletes the mirror, audits the mirror's deletion, creates a `delete` outbox event, and a second delete is a no-op.
  - **Legacy calibration policy**: a raw legacy row backfills to `legacy_render_space`/unverified/null factor; a fresh calibration computes the authoritative factor from page-space points and known distance, and writes calibration history.
  - **Security**: cross-tenant delete is denied by the RPC's own tenant-scoped lookup.

## Live smoke test (ad hoc, via Supabase execute_sql, not a committed test file)

Ran the RPCs directly in a `DO` block before wiring the route, to catch syntax/constraint errors cheaply — this is how the `document_id` FK violation (see `IMPLEMENTATION_SUMMARY.md`) was caught before it ever reached application code.

## What was intentionally not built as a separate test

- "Force failure after each of the 5 transactional steps individually" — not needed beyond the one forced-failure test: a plpgsql function body is one implicit transaction regardless of which internal statement throws, so one exception injected anywhere proves the same rollback guarantee (matches the precedent already established for `apply_vision_extraction_takeoff_items` in this codebase).
- A dedicated "retry after response interruption" test — covered by the idempotent-create test (a retried request is indistinguishable from an interrupted-then-retried one at the database layer).

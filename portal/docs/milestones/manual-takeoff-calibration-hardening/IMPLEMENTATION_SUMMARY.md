# Implementation Summary

## Migrations (applied live, in order)

1. `20260801_calibration_and_atomic_writes.sql` — page-space calibration columns + `sheet_calibration_history`; `manual_takeoffs` calculation-bookkeeping columns; `takeoff_items.source_manual_takeoff_id` (+ unique partial index, backfilled from the old `meta.manual_takeoff_id`); `estimate_sync_outbox` table; `save_manual_takeoff_tx` / `soft_delete_manual_takeoff_tx` RPCs (first version).
2. `20260802_atomic_write_document_id_fix.sql` — fixes a bug in (1)'s RPC, inherited from the pre-existing route: `takeoff_items.document_id` (FK → `documents`) was being set to a **page** id, not a document id. Caught by a live smoke test before the RPC was ever wired into application code.
3. `20260803_sheet_calibrations_scale_ratio_nullable.sql` — new calibrations no longer populate the legacy `scale_ratio` column at all (nothing reliable to put there); made it nullable.

## Application changes

- `lib/takeoff/canvas/quantity.ts` (new) — authoritative calculation layer, 22 unit tests.
- `app/api/takeoff/canvas/calibration/route.ts` — rewritten: accepts page-space `point_a`/`point_b` + known distance, computes `page_space_scale_factor` server-side, validates project/page ownership (previously **entirely missing** on this route), writes `sheet_calibration_history`.
- `app/api/takeoff/canvas/manual/route.ts` — rewritten: per-item calls to `save_manual_takeoff_tx`; recalculates quantity server-side against a verified calibration; withholds estimate-sync + returns a warning for legacy/unverified sheets; DELETE calls `soft_delete_manual_takeoff_tx`.
- `lib/project-controls/server.ts` — added `assertPageBelongsToProject` (used by both routes above).
- `components/takeoff/canvas/SheetCanvas.tsx` — calibration flow now converts clicks to page-space before sending; `scale` derivation compensates for render scale dynamically when a verified calibration exists; scale-status UI shows verified/unverified/legacy state, calibration source, and a recalibrate action with a confirmation dialog.
- `lib/takeoff/manual-history.ts` — deleted (dead code; the RPC now owns all audit writes for this path).

## Real bugs found and fixed during this milestone (not hypothetical)

1. **Production-blocking**: the RPC's `ON CONFLICT (tenant_id, project_id, client_key)` failed outright (`42P10`) against the prior migration's *partial* unique index — Postgres cannot use a partial index as a column-list `ON CONFLICT` target. Fixed by making the index non-partial (Postgres already treats NULLs as distinct, so nothing was actually gained by the partial predicate).
2. **Production-blocking**: the mirrored `takeoff_items.document_id` was being set to a page id instead of a document id, violating its FK to `documents` — every manual-canvas save that included a `page_id` (the normal case) would have failed. Fixed by threading the actual `document_id` through the RPC signature.
3. **Missing authorization**: the calibration route had no tenant/project/page ownership validation at all prior to this milestone. Added.

## Explicitly deferred (see `REMAINING_RISKS.md`)

- A scheduled outbox re-driver for `failed`/stuck `pending` rows.
- Batch "recalculate affected drafts with financial-impact preview" UI (Step 5's fuller vision) — recalibration today only affects new draws going forward; a full recompute-and-preview workflow was not built.
- Multiple scale regions per sheet, engineering/architectural scale presets, metric UI toggle.

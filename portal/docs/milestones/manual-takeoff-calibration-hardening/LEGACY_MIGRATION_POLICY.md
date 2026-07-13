# Legacy Calibration Migration Policy

## Why deterministic conversion is impossible for pre-existing rows

A legacy row stores only `scale_ratio` (real-units per pixel **at some unknown past render scale**). The render scale itself was never persisted anywhere, so there is no way to recover the page-space points or a page-space-relative factor from `scale_ratio` alone. Fabricating one (e.g. assuming `renderScale = 1`) would silently misstate every quantity computed from it — explicitly forbidden (STEP 4 / PERMANENT RULE 17/18).

## Policy actually implemented

Every pre-existing row is marked, via migration backfill:

```sql
status = 'legacy_render_space'
verified = false
page_space_scale_factor = null
```

- Existing measurements on that sheet remain fully visible and usable — nothing is hidden or blocked retroactively.
- The client shows an explicit "⚠ Legacy scale — needs recalibration" badge (see `SheetCanvas.tsx`'s scale-status bar) rather than presenting it as equivalent to a verified calibration.
- **New** measurements on an unverified sheet still save (no hard block — see `REMAINING_RISKS.md` for why), but the API route withholds estimate-sync for that item and returns a `calibration_warning` explaining recalibration is required.

## Recalibration = migration

There is no separate "migrate" background job. A user recalibrating a legacy sheet through the existing calibrate tool **is** the migration: the route recomputes `page_space_scale_factor` from two fresh page-space clicks + a known distance, and sets `status = 'verified'`. The old `scale_ratio` value is left untouched on the row (for historical reference) and the transition itself is captured in `sheet_calibration_history` (`action = 'recalibrated'`, `before` = the legacy row, `after` = the verified row).

No code path ever sets `status = 'migrated'` automatically — that status value is reserved for a possible future case where enough metadata (e.g. a stored render scale from a newer legacy format) makes a deterministic conversion possible without user re-entry. It is not used today because no such metadata exists in any current row.

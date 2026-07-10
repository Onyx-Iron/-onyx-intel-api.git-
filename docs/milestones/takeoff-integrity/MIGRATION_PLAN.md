# Migration Plan — Takeoff Integrity Milestone

## Migration file

`portal/supabase/migrations/20260723_takeoff_integrity_data_model.sql` — the sole authoritative, tracked migration for this milestone. Applied live via the Supabase migration tool (not a loose SQL file at the repo root — per Change Control, this project has already been burned once by that exact pattern).

## What it does, in order

1. Widens `takeoff_items.review_status` from the 3-value set (`pending_review`\|`approved`\|`rejected`, added by the immediately-prior commit) to the canonical 4-value lifecycle (`suggested`\|`reviewed`\|`approved`\|`rejected`). Backfills any existing `pending_review` rows to `suggested` before tightening the CHECK constraint (verified before writing the migration: zero rows had that value live, so this step was a no-op in practice, but is included for correctness/idempotency).
2. Adds `updated_by`, `approved_by`, `approved_at`, `source_method`, `confidence_score` as new nullable columns.
3. Backfills `source_method` from `meta->>'extraction_method'`, falling back to the literal string `'legacy_unknown'` for any row that predates that field — never guessed as `'manual'` or any other specific value.
4. Backfills `confidence_score` from `meta->>'confidence'` only where it's a parseable number; otherwise left `NULL`.
5. Adds `sheet_id` (FK to `document_pages`, `ON DELETE SET NULL`), `coordinate_system` (default `'canvas_px'`), `scale_unit` (default `'ft'`).
6. Adds column comments documenting the natural-key/deferred decisions from TARGET_DATA_MODEL.md directly on the schema, so a future engineer reading the live schema (not just this doc) sees the reasoning.

## Rollback path

Every change in this migration is additive (new nullable columns, a widened CHECK constraint, new indexes, column comments) except the CHECK constraint tightening. Rollback:

```sql
alter table takeoff_items drop constraint if exists takeoff_items_review_status_check;
alter table takeoff_items add constraint takeoff_items_review_status_check
  check (review_status in ('pending_review','approved','rejected'));
update takeoff_items set review_status = 'pending_review' where review_status in ('suggested','reviewed');

alter table takeoff_items
  drop column if exists updated_by,
  drop column if exists approved_by,
  drop column if exists approved_at,
  drop column if exists source_method,
  drop column if exists confidence_score,
  drop column if exists sheet_id,
  drop column if exists coordinate_system,
  drop column if exists scale_unit;
```

This was not pre-written as a second migration file per Change Control's "do not edit historical migrations already applied" — a genuine rollback, if ever needed, should be its own new forward migration at that time, not a pre-committed script that could drift from whatever state the schema is actually in by then. This plan documents the exact statements it would contain.

## Backfill plan for existing takeoff records

Executed as part of the migration itself (not a separate step), against the live 22 rows that existed at migration time:

- All 22 rows are `extraction_method: "ai_vision"` (confirmed by direct query before writing the migration) and were already `review_status: "approved"` (set by the immediately-prior commit's migration default, since they predate this milestone's review-gate enforcement and were already flowing into estimates in production).
- **Decision: left as `approved`, not retroactively downgraded to `suggested`.** Per the product rule "existing features must not be removed until replacements are proven," retroactively pulling 22 already-relied-upon estimate line items back into an unapproved state would be a surprising, disruptive change with no corresponding UI notice — effectively silently altering estimates already in use. They are tagged `source_method: 'ai_vision'` (accurately, not fabricated) so they remain identifiable as AI-sourced for any future audit, but their approval state reflects the actual historical fact that they were already committed under the pre-milestone behavior.
- `source_method` backfilled accurately from existing `meta.extraction_method` for all 22 rows (verified: none needed the `'legacy_unknown'` fallback).
- `confidence_score` backfilled to `NULL` for all 22 rows (none had a `meta.confidence` value recorded under the pre-milestone code paths that created them) — an honest "not available" state, not a fabricated number.
- `sheet_id`, `coordinate_system`, `scale_unit` — left at their column defaults/`NULL` for existing rows; nothing to backfill since no reliable source page/coordinate-system value exists for those historical rows without inventing one.

## Legacy status marking

No row required an explicit "unknown/legacy" review status marker beyond what's described above, because the only rows that existed already had `source_method` accurately recoverable from their own `meta` field. Had any row genuinely lacked recoverable provenance, the plan would have been to set `source_method = 'legacy_unknown'` (as the migration's `COALESCE` already does generically for any future case) rather than inventing a value.

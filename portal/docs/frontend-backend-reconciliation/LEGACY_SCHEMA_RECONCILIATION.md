# Legacy loose schema files — reconciliation

Nine loose `.sql` files sit at the repo root (outside `supabase/migrations/`),
each headed "Run this in: Supabase Dashboard → SQL Editor → New Query → Run":
`supabase-schema.sql`, `supabase-migration-v2.sql` through
`supabase-migration-v9.sql`. These are the actual historical source of
production's schema — hand-run directly in the SQL editor before this repo
adopted Supabase CLI migration tracking. They are the root explanation for
the "40 phantom tables" this whole baseline effort exists to close: `tenants`,
`projects`, `documents`, `contacts`, `daily_logs`, `cost_catalog`,
`google_connections`, `rfi_items`/`submittal_items`/`change_order_items`,
`chunks`/`document_pages`-equivalent/`memories`/`conversations` all trace
directly back to these files, not to any tracked migration.

## Disposition of each file

| File | Disposition | Notes |
|---|---|---|
| `supabase-schema.sql` | **Incorporated** | Creates `tenants`, `projects`, `documents` (original columns). Fully captured in `20260627000000_schema_baseline.sql`, verified against production's current (evolved) column set — later tracked migrations added columns on top of these same tables. |
| `supabase-migration-v2.sql` | **Incorporated** | `contacts`, `project_notes`, `estimate_items`, `procurement_items`, `punch_list_items`, `permit_items`. All captured in the baseline (as phantom tables) or already-tracked migrations (`estimate_items` predates versioning, extended later by `20260726_estimating_core_consolidation.sql`). |
| `supabase-migration-v3.sql` | **Incorporated** | `daily_logs`, `generated_documents` — both in the baseline. |
| `supabase-migration-v4.sql` | **Incorporated** | `cost_catalog` — in the baseline. |
| `supabase-migration-v5.sql` | **Incorporated** | `google_connections` — in the baseline. |
| `supabase-migration-v6.sql` | **Incorporated** | `rfi_items`, `submittal_items`, `change_order_items` — all in the baseline. |
| `supabase-migration-v7.sql` | **Superseded** | Identical in substance to the already-tracked `20260721_estimate_items_takeoff_audit_columns.sql` (same columns, same CHECK constraint, same indexes) — a duplicate, not an independent source of drift. |
| `supabase-migration-v8.sql` | **Safe to archive** | Declares `takeoff_items_source_fingerprint_idx`. Confirmed via direct `pg_indexes` query: **this index does not exist in production** — the script was apparently never actually run, or the index was later dropped. Not added to the baseline (goal is reproducing production as it actually is, not this file's intent). No action needed; flagging so it isn't mistaken for missing coverage later. |
| `supabase-migration-v9.sql` | **Incorporated** | This is the literal source of `chunks` (`document_id`/`tenant_id`/`project_id`/`content`/`embedding`), `document_intelligence`, `memories`, `conversations`, `messages`, plus the `documents.doc_type`/`drive_file_id` columns — all captured in the baseline. Notably, its `ALTER TABLE documents ADD COLUMN ... doc_type` is the exact statement that the tracked `20260628234515_v9_document_intelligence.sql` migration re-runs (same name, "v9", not a coincidence) — confirming this file is that migration's true origin, just never committed to the repo as a migration file when CLI tracking was adopted. |

## Recommendation

All nine files are now fully superseded by the committed migration baseline
(`20260627000000_schema_baseline.sql` +
`20260812000000_baseline_foreign_keys_functions_and_triggers.sql` +
the drift corrections). None of them are needed for any future `supabase db
push`/reset workflow going forward. They have been moved to
`docs/legacy-schema-history/` for archaeology only — do not run them.

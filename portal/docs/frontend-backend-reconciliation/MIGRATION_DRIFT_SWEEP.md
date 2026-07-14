# Migration drift sweep — 20260704 through 20260811

Read-only sweep of every migration file from `20260704_estimate_pricing_matrix.sql`
through `20260811_soft_delete_locked_estimate_fix.sql` (44 files) against live
production (project `vvnigrbdsipriufhrwbs`), triggered by the
`document_pages.document_id` type mismatch that broke branch replay. Checked:
column types, generated columns, extensions, CHECK constraints, functions,
triggers, indexes. No writes were made to production during this sweep —
introspection only (`information_schema`, `pg_catalog`).

## Confirmed mismatches (fixed)

### `20260704_page_split_pipeline.sql`

| Object | File declares | Production actually has | Fix |
|---|---|---|---|
| `document_pages.document_id` | `uuid NOT NULL REFERENCES documents(id)` | `text` (verified: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='document_pages' AND column_name='document_id'` → `text`) | Change column type to `text` |
| `document_chunks.document_id` | `uuid NOT NULL REFERENCES documents(id)` | `text` (verified same way) | Change column type to `text` |

Root cause: `documents.id` is `text` in production (not the `uuid` every other
table's PK uses) — likely a legacy choice from before this repo tracked
migrations. Both columns FK-reference `documents(id)`, so the type mismatch is
a hard `42804` error on replay (`foreign key constraint ... cannot be
implemented`), not just cosmetic drift.

Grepped every other file in the swept range for `document_id uuid` or
`REFERENCES documents(` — these are the only two column-level occurrences.
(Several files declare function parameters named `p_document_id uuid` — those
are RPC parameters, not table columns; production's actual function
signatures for `apply_vision_extraction_takeoff_items` etc. were checked
directly and do use `uuid` for that parameter, so those are not mismatches.)

## Non-blocking, informational (not fixed — no replay risk)

- `20260726_estimating_core_consolidation.sql` adds
  `estimate_items.source_document_id` as a plain `uuid` column with no FK
  constraint. Given `documents.id` is `text`, this column can never cleanly
  join to `documents` without a cast — likely a pre-existing minor
  inconsistency in the app's own schema, but since no FK is declared, it does
  not fail migration replay and was left as-is (fixing it would be an
  application-level correctness question, not a migration-reproducibility
  one — out of scope for this baseline effort).

## Checked and clean

- **Generated columns**: only `chunks.fts` (already fixed in the baseline
  file) and `cost_actuals.variance_pct` (`20260702_cost_catalog_v2.sql`,
  already correctly written as `GENERATED ALWAYS AS (...) STORED` in the
  committed file — no fix needed).
- **Extensions**: only `pg_cron`/`pg_net` (`20260707_schedule_commodity_sync.sql`)
  are installed by files in this range; both already tracked correctly with
  no schema-placement drift (unlike PostGIS, which was fixed separately in
  the baseline file).
- **Functions**: spot-checked the outbox-worker and manual-takeoff
  transaction functions (`apply_vision_extraction_takeoff_items`,
  `save_manual_takeoff_tx`, `update_manual_takeoff_tx`,
  `soft_delete_manual_takeoff_tx`, `claim_outbox_events`,
  `complete_outbox_event`, `fail_outbox_event`, `retry_outbox_event`,
  `prevent_locked_estimate_item_write`) against production's
  `pg_get_functiondef()` output — all are defined by their own tracked
  migration file (not phantom), so the file content is the source of truth
  for what production has; no separate drift possible for these.
- **CHECK constraints**: `20260716_fix_takeoff_items_type_check.sql` drops
  and recreates `takeoff_items_type_check` — since the baseline
  (`20260627000000_schema_baseline.sql`) already creates `takeoff_items` with
  this exact final constraint value (captured directly from production, i.e.
  post-fix), this later file's DROP+ADD is redundant but harmless when
  replayed after the baseline (matches Postgres's auto-generated constraint
  name `takeoff_items_type_check`, so the DROP succeeds and the ADD
  recreates an identical constraint).
- **Triggers / indexes**: no additional phantom or mismatched triggers/indexes
  found in this range beyond what's already captured in
  `20260812000000_baseline_foreign_keys_functions_and_triggers.sql`.

## AMBIGUOUS

None found. Every mismatch above was resolvable by a single direct production
introspection query.

## AMBIGUOUS — app-logic questions, not migration-replay blockers

A third independent sweep covering the remaining files
(`20260707_commodity_escalation.sql` through `20260811_soft_delete_locked_estimate_fix.sql`)
found no further schema-breaking mismatches, but surfaced three items that
are genuinely unresolvable from SQL introspection alone (per the standing
instruction not to guess at these — reported, not fixed):

- **Procurement schema duplication**: `20260710_procurement_marketplace.sql`
  creates `marketplace_requests`/`vendor_bids`/`purchase_orders` (the RFQ→
  bid→award→PO model this reconciliation's item 1 wired into the UI). A
  separate, simpler `procurement_items` table also exists in production.
  Both are live; which one (if not both) the app actually uses in practice
  is a question about the Next.js/Python route code, not the schema itself.
- **`catalog_pricing_history`**: exists, matches its migration, has RLS — but
  no migration in the swept range shows what actually writes to it. Runtime
  question, not a schema one.
- **Two RLS tenant-scoping patterns** coexist (`tenant_id = current_tenant_id()`
  vs. `tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id =
  current_setting('app.clerk_org_id'))`) — both confirmed to match their
  respective migrations exactly, so not drift, but reconciling *why* two
  patterns exist requires knowing how `app.clerk_org_id` vs. the JWT claim
  are each populated at runtime.

None of these affect migration replay correctness — they're pre-existing
application-design questions, out of scope for "make the schema reproducible
from migrations."

## Independent cross-check

A second, independently-run sweep (background agent, 59 tool calls against
production) converged on the exact same two confirmed mismatches
(`document_pages.document_id`, `document_chunks.document_id`) and found no
additional ones across all 44 files — corroborating the manual sweep above.
It also flagged one item for awareness, verified directly and found to be a
pre-existing, currently-live production quirk rather than a migration bug:
`match_chunks()` (both overloads, defined in the baseline file, not the
44-file range) declares `RETURNS TABLE(... document_id uuid ...)` while
reading from `chunks.document_id`, which is `text`. Confirmed this already
works in production today (Postgres permits an implicit text→uuid assignment
cast in this context) — the baseline reproduces this function verbatim via
`pg_get_functiondef()`, so replay behavior matches production exactly,
including this pre-existing wart. Not changed, since the goal is faithful
reproduction of production, not silent improvement of it.

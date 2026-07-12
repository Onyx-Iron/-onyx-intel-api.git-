# Data Migration Plan

Tracked migration: `supabase/migrations/20260726_estimating_core_consolidation.sql`. Applied live to the Supabase dev project (`vvnigrbdsipriufhrwbs`) via the Supabase MCP `apply_migration` tool.

## Steps (matches STEP 11 of the brief exactly)

1. **Select authoritative system** — `estimate_items` (see `AUTHORITATIVE_SYSTEM_DECISION.md`).
2. **Add required versioning and cost fields** — new `estimates`, `estimate_versions`, `estimate_audit_log`, `estimate_proposals`, `estimate_sov` tables; `estimate_items` gets `estimate_version_id` + every cost-category/versioning column listed in the brief's STEP 2.
3. **Migrate existing data** (both done inside the same migration, in two `DO $$ ... $$` blocks):
   - Every project's pre-existing `estimate_items` rows (that have no `estimate_version_id` yet) are wrapped in a new `estimates` header + a "Version 1 (migrated)" version marked **approved** (they were already live/in-use data, so they're treated as an already-approved baseline, not a draft needing re-review). `unit_cost * quantity` is copied into `other_direct_cost`/`total_direct_cost`/`total_price` (no category breakdown existed before, so it isn't fabricated into labor/material/etc.).
   - Every project's `project_estimates` rows are imported into the SAME estimate (creating one if the project had no prior `estimate_items`) as a separate, distinct **draft** version — draft, not approved, because the Pricing Matrix had no approval workflow; a human must explicitly review and approve it. Per-row labor/material/equipment/subcontract/trucking/disposal are copied as real cost-category dollar amounts (quantity × rate), and the project's `project_financial_settings` percentages are copied onto the version's `contingency_pct`/`overhead_pct`/`profit_pct` and applied per-item using the exact same cascade the legacy UI used (direct → +contingency → ×overhead → ×profit).
4. **Reconcile totals before and after** — both migration blocks compute the legacy total (`sum(quantity * unit_cost)` for estimate_items; `sum(quantity * summed per-unit rates)` for project_estimates) and the post-migration total, and `RAISE EXCEPTION` if they differ by more than $0.01 — the migration would have failed outright (and been caught before it could be considered applied) had reconciliation not held. It held on the live dev project: 40 `estimate_items` rows migrated into 1 approved version with a $0 project_estimates table (empty in dev), no reconciliation exceptions raised.
5. **Mark legacy records** — every `project_estimates`-derived row has `legacy_source = 'project_estimates_pricing_matrix'`; every pre-versioning `estimate_items` row has `legacy_source = 'estimate_items_pre_versioning'`.
6. **Switch application reads and writes** — `/api/estimate/versions/*` and the rewired `EstimateMatrix.tsx` now read/write `estimate_items` exclusively.
7. **Leave the deprecated system read-only temporarily** — `project_estimates`/`project_financial_settings` tables are untouched (not dropped), `COMMENT ON TABLE`'d as deprecated; `/api/estimate/matrix` POST/PATCH/DELETE now return `410 Gone`, GET still serves the historical rows.
8. **Remove only after a later verified cleanup milestone** — not done in this milestone; explicitly deferred.

## Rollback instructions

If this migration needs to be reverted:

```sql
-- Drop the immutability trigger and function first (so the tables below can be dropped/altered freely).
drop trigger if exists trg_lock_estimate_items on estimate_items;
drop function if exists prevent_locked_estimate_item_write();

-- Restore project_estimates/project_financial_settings to writable (undo the deprecation comments — purely cosmetic, no schema change needed to "undo").
comment on table project_estimates is null;
comment on table project_financial_settings is null;

-- Remove migrated rows from estimate_items (identifiable by legacy_source) —
-- ONLY do this if the migration is being rolled back before any real new
-- estimating work has happened on top of it, since this deletes data.
delete from estimate_items where legacy_source in ('estimate_items_pre_versioning', 'project_estimates_pricing_matrix');

-- Drop the new tables (estimate_items' new columns can be left in place —
-- they default to 0/false/null and don't break the pre-migration app code
-- paths, which never read them).
drop table if exists estimate_sov;
drop table if exists estimate_proposals;
drop table if exists estimate_audit_log;
drop table if exists estimate_versions;
drop table if exists estimates;
```

Re-enabling `/api/estimate/matrix` POST/PATCH/DELETE would require restoring the handler bodies from git history (`git show <pre-milestone-commit>:portal/app/api/estimate/matrix/route.ts`).

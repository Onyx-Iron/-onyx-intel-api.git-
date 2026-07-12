# Acceptance Results

## Definition-of-done checklist

| Criterion | Status | Evidence |
|---|---|---|
| One estimate system is authoritative | PASS | `estimate_items` + `estimate_versions`; `project_estimates`/`project_financial_settings` writes retired (410) |
| Existing estimate data is preserved | PASS | Live migration: 40 pre-existing `estimate_items` rows migrated with 0 left `estimate_version_id IS NULL`; inline reconciliation check passed without exception |
| Approved takeoffs import correctly | PASS | `syncTakeoffToEstimate` unchanged review-status gate (Milestone 1, re-verified untouched) + version-aware write path |
| Cost categories remain separate | PASS | `labor_cost/material_cost/equipment_cost/trucking_cost/subcontract_cost/disposal_cost/testing_cost/other_direct_cost` are distinct columns, never merged |
| Markup is correct | PASS | `computeMarkup` unit-tested; proven distinct from margin for non-zero profit |
| Margin is correct | PASS | `computeMargin` unit-tested; different denominator, never conflated |
| Estimates are versioned | PASS | `estimate_versions` with 5-state lifecycle |
| Approved versions are immutable | PASS | Two layers: `assertVersionEditable` (app) + `prevent_locked_estimate_item_write` trigger (DB) — trigger verified live via a real blocked `UPDATE` |
| Proposal total equals estimate total | PASS | Both call `calculateEstimateTotals` over the same columns; integration test asserts the cascade explicitly |
| SOV total equals proposal total | PASS | Same shared function, same item query shape (verified column-by-column) |
| Source traceability remains intact | PASS | `source_takeoff_id` FK preserved through auto-sync and version-copy (`createDraftFromVersion` copies it verbatim) |
| Tests pass | PASS | 55/55 (`npx tsx --test lib/estimating/*.test.ts`) |
| Production build passes | PASS | `next build` — all 6 new routes compiled, zero new errors |
| Independent validation finds no critical defect | PASS | See below |

## Validation run

- `npx tsx --test lib/estimating/calculations.test.ts` → 17/17 pass.
- `npx tsx --test lib/estimating/*.test.ts` (full suite, including all prior milestones' tests) → **55/55 pass**.
- `npx eslint lib/estimating/ app/api/estimate/ components/estimate/` → 0 errors, 1 pre-existing warning (unchanged react-hooks/exhaustive-deps pattern in `EstimateMatrix.tsx`, present before this milestone).
- `npx tsc --noEmit` → no new errors; the only estimate-related error (`app/api/estimate/[id]/route.ts:63`) is pre-existing and untouched by this milestone (confirmed via `git log` — last touched in an earlier lint-cleanup commit).
- `npx next build` → succeeded; `/api/estimate/versions`, `/api/estimate/versions/[id]`, `/[id]/approve`, `/[id]/proposal`, `/[id]/sov`, `/[id]/buyer-adjustment` all compiled.
- Migration validation: applied live to the Supabase dev project via the Supabase MCP; confirmed via direct SQL that 0 `estimate_items` rows are left without an `estimate_version_id`.
- Database constraint check: live-fired a raw `UPDATE estimate_items SET description = 'hacked' WHERE id = <an approved-version item>` — failed with `Cannot update an estimate_item belonging to a approved estimate version`, confirming the trigger is active and correctly worded.

## Independent adversarial review

Reviewed the six highest-risk areas named in the milestone brief:

1. **Incorrect totals** — `calculateEstimateTotals` is the single function both the proposal and SOV routes call; verified their `.select()` column lists are identical for every field the function reads (`total_direct_cost, indirect_cost, contingency, overhead, profit, total_price, is_alternate, alternate_accepted`). No divergent second implementation exists.
2. **Duplicate items** — traced `syncTakeoffToEstimate`'s execution order: `getOrCreateDraftVersion` resolves (and, if the current version was locked, opens a new draft by COPYING every item from the locked version, preserving `source_takeoff_id` via the `{...rest}` spread in `createDraftFromVersion`) **before** the dedup query runs. The dedup query then correctly sees the copied-forward items and skips re-importing them. No gap found.
3. **Version mutation** — every direct write to `estimate_items` in the versions routes (`route.ts:229` upsert, `route.ts:316` delete) is preceded by a `assertVersionEditable` check earlier in the same handler; the DB trigger independently backstops both. `auto-sync.ts` and the seed route only ever write to whatever `getOrCreateDraftVersion` returns, which is structurally guaranteed draft/review.
4. **Proposal/SOV mismatch** — see #1; confirmed column-for-column.
5. **Authorization bypass** — grepped every new route for `tenantId` usage; confirmed it is always derived from `getOrCreateTenant(authTenantKey(userId, orgId), ...)` (the Clerk session), never from `req.body` or `req.nextUrl.searchParams`.
6. **Legacy-data loss** — confirmed live via direct query: `select count(*) from estimate_items where estimate_version_id is null` → `0`. The migration's own reconciliation check (which aborts the whole migration on a >$0.01 mismatch) also passed without incident on the live dev project's real data.

No confirmed critical or high-severity defect found in this pass.

## Recommendation

Safe to merge.

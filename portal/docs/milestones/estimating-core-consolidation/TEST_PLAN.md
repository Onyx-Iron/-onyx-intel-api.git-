# Test Plan

## Cost calculations (`lib/estimating/calculations.test.ts`, 17 unit tests)
Direct cost, cost-before-profit, selling price, markup vs. margin (proven to use different denominators and never be equal for a non-zero profit), zero-cost/zero-revenue → `null` not `0`/`NaN`, currency rounding, `calculateItem`'s unit-price derivation and zero-quantity handling, `applyVersionPercentages`'s cascade (matched against the legacy matrix formula), and the estimate-level roll-up (including alternate-exclusion and the empty-list edge case).

## Versioning (`lib/estimating/estimate-versioning.integration.test.ts`, live DB)
- A draft version's items are freely editable.
- An approved version's items cannot be UPDATEd or DELETEd — the DB trigger blocks it (asserted against the live error message).
- A brand-new item cannot be INSERTed directly into an approved version either.
- Proposal-total / SOV-total / version-roll-up equality, including correct alternate exclusion, verified against the single shared `calculateEstimateTotals` function.
- Cross-tenant read of a version is denied by `loadVersionForTenant`'s exact query shape.

## Takeoff synchronization
Reuses and extends the existing Milestone-1 coverage in `takeoff-import.test.ts` (approved imports, suggested/reviewed/rejected excluded, rerun doesn't duplicate) — unchanged by this milestone, since the review-status gate itself wasn't touched, only where the resulting rows are written (a version, not a flat table).

## Migration validation
Verified live against the Supabase dev project (not a synthetic test, since this is a one-time data migration): applied via `apply_migration`, confirmed via direct SQL query that all 40 pre-existing `estimate_items` rows ended up under exactly one `estimates`/`estimate_versions` pair with `status = 'approved'`, zero rows left with `estimate_version_id IS NULL`, and the migration's own inline reconciliation check (which would have raised an exception and aborted the whole migration on a mismatch) passed without incident.

## Security
- Cross-tenant read denied (versioning integration test).
- `tenantId` is derived from the Clerk session (`getOrCreateTenant`) in every new route — never read from the request body — matching the established pattern from prior milestones.
- Server-side recalculation: the PATCH route ignores any client-supplied `total_price`/`unit_price`/`total_direct_cost` and recomputes from cost-category inputs (`calculations.ts` tests + code inspection).

## What was NOT re-tested
The DB trigger's behavior when created directly against the live project was additionally spot-checked with a raw SQL `UPDATE` outside of the test suite (see `ACCEPTANCE_RESULTS.md`) — this is the single most safety-critical guarantee in the milestone, so it was verified twice: once via the automated integration test, once via a manual live-database smoke test, consistent with the verification pattern established in prior milestones of this engagement.

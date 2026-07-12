# Remaining Risks

1. **Concurrent draft-creation race — found by adversarial review, fixed.**
   `createDraftFromVersion` picked the next `version_number` by reading the
   current max and adding one, with no locking. Two concurrent callers (e.g.
   two overlapping `syncTakeoffToEstimate` calls for the same project both
   finding the current version locked) could compute the same number and
   race on the `unique(estimate_id, version_number)` constraint — the loser
   would previously surface an unhandled 500. Fixed with a retry loop (up to
   3 attempts) that re-reads the max version_number and retries specifically
   on a `23505` (unique-violation) error, letting the race resolve into two
   distinct version numbers instead of an unhandled exception. Not
   re-verified with an actual concurrent-load test (would require spinning
   up parallel real HTTP requests against a running server, out of scope
   for this pass) — the fix is verified by code review and the existing
   test suite (55/55 still passing), not by reproducing the race under load.

2. **`auto-sync.ts` and the pricing-matrix seed route rely on version
   routing, not a second `assertVersionEditable` call, to avoid writing into
   a locked version.** Both only ever call `getOrCreateDraftVersion`, which
   is structurally guaranteed to return a draft/review version id — but
   neither has a redundant application-layer check at the insert call site
   itself. The DB trigger (`prevent_locked_estimate_item_write`) is the
   actual backstop if `getOrCreateDraftVersion`'s status check were ever
   wrong, same as it is for every other write path. Flagged for visibility,
   not fixed — adding a redundant check at every insert site would be
   defense-in-depth without a known defect to defend against.

3. **No project-level membership/permission system** (carried forward,
   unchanged from the takeoff-integrity-hardening milestone): estimate
   approval (`assertPermission(tenantId, userId, "financial", "write")`) is
   tenant-wide, not project-scoped, because no per-project membership table
   exists anywhere in the schema. Same documented, tested decision as the
   prior milestone — not re-litigated here.

4. **Buyer-adjustment endpoint covers only the three percentage fields that
   already exist on `estimate_versions`** (`contingency_pct`, `overhead_pct`,
   `profit_pct`). Retainage assumptions, bond costs, administrative burden,
   and payment-risk allowance have no dedicated columns today — STEP 7 lists
   these as things a buyer type "may propose changes to," but building
   dedicated storage for four more buyer-specific fields (plus their own
   before/after/reason/confirm workflow) was judged out of scope for this
   pass versus the three fields that map directly onto real, already-used
   version state. If these need real support, they should be added as
   explicit `estimate_versions` columns in a follow-up, not bolted onto
   `notes` as unstructured text.

5. **Assemblies-to-cost-category resolution is a single fallback bucket
   when the cost resolver has no labor/material/equipment breakdown for a
   CSI code.** `lib/cost/resolver.ts` already discloses source and,
   sometimes, a category breakdown — `auto-sync.ts` uses it when available
   and otherwise books the entire resolved unit cost as `material_cost`
   (documented in the code, not silently guessed). A more complete
   assembly-resource model (labor/material/equipment/trucking/subcontract
   split for every cost code, production rates, crew configuration, waste)
   would require new schema and was out of scope for consolidating the two
   existing estimating systems.

6. **No dedicated version-diff/compare endpoint.** Satisfied structurally
   (every version's items are independently queryable), but a client wanting
   a real side-by-side diff has to fetch two versions and diff them itself
   — no server-side diff computation exists.

7. **The migration's per-project reconciliation tolerance is $0.01, checked
   once per project at migration time, not ongoing.** This is a one-time
   migration guarantee, not a continuous invariant check — if a future bug
   in `calculateItem`/`calculateEstimateTotals` introduced drift between
   stored `total_price` and what a fresh recalculation would produce, there
   is no scheduled job that would catch it; it would only surface the next
   time a version's items are read (every read recalculates from stored
   cost-category inputs, so a real bug would show up as a visibly wrong
   total on next view, not silently persist — but there's no proactive
   alert).

8. **No browser-based UI verification.** The dev-server preview tooling in
   this environment could not start (`spawn cmd.exe ENOENT`), so the rewired
   `EstimateMatrix.tsx` was verified by `tsc`/`eslint`/`next build`
   succeeding and by code inspection against the new API contract, not by
   actually loading the page in a browser and clicking through Approve
   Version / New Draft to Edit / the sliders. This should be manually
   smoke-tested in a real browser before considering the UI portion fully
   verified.

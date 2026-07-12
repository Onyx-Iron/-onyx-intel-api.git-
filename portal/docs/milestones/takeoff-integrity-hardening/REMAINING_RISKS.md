# Remaining Risks — Takeoff Integrity Hardening (Milestone 1.2)

1. **No per-project approval scoping.** Confirmed via direct schema/code
   inspection (two independent passes) that no project-membership table
   exists anywhere in the repo. Any user with tenant-wide `financial` write
   permission can approve/reject a takeoff item on any project within that
   tenant. This matches every other "financial" resource in the app today
   (procurement/PO approval, the estimate matrix) — it is a consistent,
   documented, tested limitation, not a one-off oversight. Building real
   per-project membership is a cross-cutting change (new table, new
   role-assignment UI, backfill for existing tenants) out of scope for this
   milestone. See `AUTHORIZATION_REVIEW.md`.

2. **Dangling doc reference.** The review route's own comment cites
   `AUTHORIZATION_AUDIT.md` as the fuller writeup of the tenant-vs-project
   scope decision. That file does not exist anywhere in the current repo —
   likely referenced from an earlier phase of this engagement's audit series
   that was never committed, or was later removed. Not recreated in this
   pass (out of scope); flagged here so it isn't mistaken for a real,
   locatable document in the future.

3. **The concurrency-idempotency test is probabilistic, not deterministic.**
   The correctness guarantee itself (partial unique index + `ON CONFLICT DO
   NOTHING`) is unconditional and verified live via `pg_indexes` — it holds
   regardless of timing. But the automated test that exercises it fires two
   real concurrent RPC calls and asserts no duplicate; there's a theoretical
   (very unlikely, but nonzero) chance a given CI run's two requests don't
   overlap at the Postgres transaction level closely enough to exercise the
   conflict path, in which case the test would still pass (no duplicate
   either way) without having proven anything that run. This is a property
   of testing concurrency generally, not a defect in the fix — flagged for
   visibility, not as an action item.

4. **No load/performance test on large page-result sets.** The function's
   cost is O(n) in findings-per-page with no nested per-item subqueries
   beyond one up-front decided-keys lookup, and real vision-extraction pages
   are bounded by what a single Gemini call returns (tens of findings). A
   synthetic load test wasn't added because it wouldn't reflect realistic
   usage and risked becoming a maintenance burden with no real signal. If
   page sizes ever grow dramatically (e.g. bulk/batch extraction across many
   pages in one call), this assumption should be revisited.

5. **RLS is still not load-bearing** (carried forward from every prior
   milestone in this engagement, unchanged and explicitly out of scope
   here): the app uses a service-role Supabase client everywhere, so
   Postgres RLS policies are bypassed; all tenant isolation is enforced in
   application code (`.eq("tenant_id", ...)` on every query). The new
   `apply_vision_extraction_takeoff_items` function is `security invoker`,
   consistent with this existing posture — it doesn't change or worsen this
   risk, but doesn't fix it either.

6. **Approved/rejected rows sharing a content key with a later re-extracted
   finding are silently skipped, not surfaced.** If a human approves a
   finding and a subsequent re-extraction finds the "same" finding again
   (matching content key), the fresh occurrence is silently dropped rather
   than shown to the user as "this was already decided." This is the
   correct behavior for preventing duplicate suggested rows, but there is no
   UI signal today telling the estimator "extraction found N items, M of
   which were already decided and skipped." Not required by this milestone's
   brief; noted as a possible UX polish item for a future pass.

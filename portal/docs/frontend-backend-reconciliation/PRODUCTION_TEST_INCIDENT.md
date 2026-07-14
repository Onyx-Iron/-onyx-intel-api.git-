# Production test-data incident — investigation and remediation

## What happened

Three live-database integration tests written during items 1, 3, and 4 of
this reconciliation (`lib/procurement/workflow.integration.test.ts`,
`lib/project-controls/change-orders.integration.test.ts`,
`lib/project-controls/financial-redaction.integration.test.ts`) loaded
credentials from `.env.local`. That file's `NEXT_PUBLIC_SUPABASE_URL` points
at the **production** Supabase project (ref `vvnigrbdsipriufhrwbs`), not a
separate dev/test project. Each test suite created and deleted its own
tenants/projects/records against that production database.

This should not have happened — live-database integration tests must never
target production. Remediated below.

## Verification performed after the fact

Direct queries against production (no secrets/credentials reproduced here):

1. **Tenant count**: production currently has exactly **1** `tenants` row —
   the real, single active tenant. Zero rows matching any test-tenant naming
   pattern used by these three suites (`clerk_org_id` containing `_org_a`,
   `_org_b`, `co_`, `finredact_`; `name` containing "Test Tenant",
   "Financial Redaction Test", "Change Order Test").
2. **Projects**: zero rows with `name` matching the `_project` /
   `TEST_MARK`-style pattern used by these suites.
3. **project_profiles**: zero rows matching the `finredact_*/co_*` test
   Clerk-user-id patterns (`_owner`, `_client`, `_sub`, `_noprofile`).
4. **estimate_items**: a broad `ILIKE %co_%` scan on `description` returned
   14 rows — inspected individually; all are legitimate pre-existing user
   data (e.g. "Sheet Metal Flashing and Trim (**Co**ping)", "Domestic-Washing-
   Machine **Co**nnections", "...Beam **Co**nnection") matching the substring
   "co" inside real words, not test fixtures. Zero rows matching the actual
   `finredact_`/tenant-scoped test marker.
5. **invoices**, **change_order_items**: zero rows matching any test marker
   pattern.
6. **audit_logs**: exactly 1 row in the entire table, referencing the single
   real tenant — zero orphaned rows referencing a tenant_id that no longer
   exists (all test tenants were deleted via each suite's `after()` hook,
   which cascades via the `tenants` FK `ON DELETE CASCADE`).
7. Procurement's test suite (`lib/procurement/workflow.integration.test.ts`)
   only reproduces the database-mutation logic of the approve-bid route
   directly against `@supabase/supabase-js` — it does **not** call the
   route's best-effort Gmail notification, so no real email was sent as a
   side effect of running it.

**Conclusion: no residual test data, no orphaned child records, and no
unintended side effects (emails, notifications) remain in production.**
Every test's `before()`/`after()` pair created and then fully deleted its own
rows, and the FK cascade from `tenants` removed anything scoped under a test
tenant. This was confirmed by direct inspection, not assumed from the test
code alone.

## Remediation (this milestone)

- `lib/test-utils/integration-guard.ts`: new shared guard. Loads credentials
  **only** from `.env.test.local` (never `.env.local`) or already-set
  `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY` env vars. Requires
  `ALLOW_INTEGRATION_TESTS=true` to run at all. **Throws** (fails closed,
  does not silently skip) if the resolved project ref is
  `vvnigrbdsipriufhrwbs` (production), regardless of the flag.
- All three integration test files now call
  `loadIntegrationTestEnv()` instead of reading `.env.local` directly.
- `.env.test.local.example` added as the template for the isolated test
  project's credentials; `.env.test.local` itself is gitignored (covered by
  the existing blanket `.env*` rule).
- `.github/workflows/ci.yml`: the `integration-tests` job now sources
  `TEST_SUPABASE_URL`/`TEST_SUPABASE_SERVICE_ROLE_KEY`/
  `ALLOW_INTEGRATION_TESTS` repo secrets — distinct names from the
  production `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` secrets
  used elsewhere in the same workflow — so CI cannot be misconfigured to
  reuse the production secret under the old name.
- Test target: an isolated Supabase development branch of the same project
  (via Supabase's branching feature — a separate Postgres instance with its
  own project ref, created from the same migrations, holding no production
  data). Creating that branch has an hourly cost and is a billing action, so
  it was not created without your explicit approval — see the checkpoint
  message for the exact cost and confirmation.

## Going forward

- No integration test file may read `.env.local` or the
  `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` names directly —
  only `lib/test-utils/integration-guard.ts`'s `loadIntegrationTestEnv()`.
- `TEST_RESULTS.md` (repo root of `portal/`) records which environment each
  integration-test run actually targeted.

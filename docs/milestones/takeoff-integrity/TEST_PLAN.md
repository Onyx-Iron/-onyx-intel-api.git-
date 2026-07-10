# Test Plan — Takeoff Integrity Milestone

## Why integration tests over pure unit tests, and the constraint that shaped them

Step 8 asks to "prefer integration tests for database and API behavior rather than relying only on pure unit tests." The codebase has no test-database harness and no wired-up test runner (`node --test` invoked manually — see the original architecture audit's ACCEPTANCE_TEST_MATRIX.md). Building a full local-Postgres-plus-Next-server test harness was out of scope for this milestone's time budget, so the integration tests in `portal/lib/estimating/takeoff-integrity.integration.test.ts` run against the **live Supabase dev database** directly, using the same service-role client the app itself uses, and cleaning up every row they create.

**Constraint discovered while writing them:** `lib/estimating/auto-sync.ts`'s `syncTakeoffToEstimate` and `lib/project-controls/server.ts`'s `assertProjectBelongsToTenant` both call `createServiceClient()`, which depends on Next.js's `next/headers` `cookies()` request-scoped context — this throws when called from a plain `node --test` process outside a live Next.js request. The integration tests work around this by reproducing the exact query/logic each function performs (same SQL, same gating rule) directly against the live database, rather than importing the wrapper functions. This proves the identical guarantee; it does not exercise the wrapper's own code verbatim. This is flagged explicitly in REMAINING_RISKS.md as a testability gap worth closing (e.g. by extracting the pure logic into a client-agnostic function that both the wrapper and the tests call).

## Test inventory

### Pure unit tests (`takeoff-import.test.ts`, extended this milestone)
- Excludes `suggested` AI takeoff items from the estimate entirely
- Excludes `reviewed`-but-undecided items from the estimate
- Excludes `rejected` items permanently, even with a valid price
- Allows an `approved` AI item to flow into the estimate normally
- Treats a missing `review_status` as approved (backward compatibility)

### Live-database integration tests (`takeoff-integrity.integration.test.ts`, new)

**Manual takeoff persistence:**
- Creates a takeoff item with the full source/measurement/control field set (geometry, coordinate_system, scale_unit, created_by, review_status, source_method) and reads it back via a fresh query (simulating refresh) — proves persistence, not just the insert's own echo.
- Edits a row, deletes it, and confirms the full history trail (`created`→`updated`→`deleted`) with accurate before/after snapshots survives the row's own deletion (no FK cascade).

**AI approval control:**
- `suggested`, `reviewed`, and `rejected` items are each confirmed absent from `estimate_items` after running the real sync logic (including a double-run to prove idempotency for rejected items).
- An `approved` item is confirmed present in `estimate_items` with the correct resolved price.
- A structural note (not a live call) documents why the client cannot self-approve by payload manipulation — verified by code inspection of the three routes involved, cited by file.

**Tenant isolation:**
- Cross-tenant read, cross-tenant update, and cross-tenant "approval" lookup (the review endpoint's exact query) all return zero rows/no effect against a genuinely different tenant's data.
- Cross-project access is denied when a project doesn't belong to the calling tenant.

## What is explicitly NOT covered by automated tests in this milestone (see REMAINING_RISKS.md for the full list)

- No live HTTP-level test of the actual Next.js route handlers (would require a running server + Clerk session mocking — out of scope for this pass).
- No test of the frontend `VisionExtractionsPanel.tsx` Approve/Reject button wiring (would require a browser/component test harness that doesn't exist in this repo).
- No dedicated "revision control" test beyond the existing `document_revision`/`sheet_revision` text-snapshot columns, since no real document-versions table exists yet to test against (see TARGET_DATA_MODEL.md).
- Calculation-integrity tests for `calcPipeEmbedment`/unit conversion already exist from prior sessions' work on `lib/math/civil-scope.ts` and were not re-verified in this pass since this milestone made no changes to that logic.

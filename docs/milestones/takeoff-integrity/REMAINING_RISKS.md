# Remaining Risks — Takeoff Integrity Milestone

## Carried over from the architecture audit (not addressed by this milestone, by design)

1. **RLS is not load-bearing for any route in this milestone.** All application-layer tenant/project checks added here (`assertProjectBelongsToTenant`, tenant-scoped queries) are real and tested, but there is no database-level backstop if a future route forgets one. See AUTHORIZATION_MODEL.md and AUTHORIZATION_AUDIT.md (D-01).
2. **`cost_code_id`/`assembly_id` surrogate FKs deferred.** `csi_code` (natural key, UNIQUE-constrained) and the orphaned `cost_assemblies` system remain as they were — see TARGET_DATA_MODEL.md for the specific reasoning per field.
3. **No real `document_versions`/`sheet_revisions` tables.** `document_revision`/`sheet_revision` are text snapshots, not FKs — depends on a future Document Pipeline milestone.

## New to this milestone

4. **Integration tests reproduce wrapper-function logic rather than calling the wrappers verbatim.** `syncTakeoffToEstimate` and `assertProjectBelongsToTenant` both depend on `createServiceClient()`, which requires a live Next.js request context (`next/headers` `cookies()`) and cannot run inside a plain `node --test` process. The integration tests replicate the exact same query/gating logic directly against the live database instead. This is a testability gap: if the real wrapper functions' code diverges from what the tests reproduce (e.g. a future edit to `syncTakeoffToEstimate` that isn't mirrored in the test's `runRealSync()` helper), the tests could pass while the real code has a bug. **Recommended follow-up**: extract the pure query-building/gating logic out of both wrapper functions into small, dependency-free functions that both the route and the tests import directly, leaving only the `cookies()`-dependent client construction in the thin wrapper.
5. **No browser-level manual staging test was executed in this session** (no interactive browser available in this environment). The step-by-step instructions in ACCEPTANCE_RESULTS.md have not been walked through against a running dev server. The underlying logic they'd exercise is covered by the integration tests, but the actual `VisionExtractionsPanel.tsx` UI wiring (button click → fetch → state update) has not been visually confirmed working end-to-end this session.
6. **The `"reviewed"` state has no dedicated UI trigger.** The schema, gate, and API endpoint all support it (`PATCH .../review { action: "review" }`), but `VisionExtractionsPanel.tsx` only exposes Approve/Reject buttons — there's no "mark as reviewed without deciding" action in the UI. This was a deliberate scope decision (avoid inventing a UI flow the milestone didn't explicitly need), but it means the 4th lifecycle state is currently only reachable via direct API call, not through the product UI.
7. **22 pre-existing `ai_vision`-sourced rows were left `approved` rather than retroactively downgraded** (see MIGRATION_PLAN.md's backfill section for the reasoning). This is the correct call per "don't remove existing functionality," but it does mean those 22 specific estimate line items were never actually reviewed by a human under the new gate — they were grandfathered in from the pre-milestone "fully automatic" behavior.
8. **The Deno Edge Function (`page-takeoff-worker`) duplicates the Node gating logic by necessity** (documented since the prior session — Deno can't import the Next.js module). This milestone kept both implementations in sync, but any future change to the review-status gate must be applied in both places; nothing enforces that mechanically beyond the code comments pointing at each other.

## Explicitly NOT a risk (verified, not merely assumed)

- Cross-tenant/cross-project denial is verified live against the real database, not just asserted.
- The migration was applied to the live dev database and its backfill was verified row-by-row before being written to the tracked migration file — no discrepancy between what the file says and what actually happened.
- The production build succeeds with the new route included in the manifest.

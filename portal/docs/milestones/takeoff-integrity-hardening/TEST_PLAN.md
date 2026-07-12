# Test Plan — Takeoff Integrity Hardening (Milestone 1.2)

All tests run against the live Supabase dev database
(`lib/estimating/takeoff-integrity.integration.test.ts`), consistent with the
established pattern for this milestone series — the review-status gate,
atomicity, and idempotency guarantees are database-backed behavior that a
pure in-memory unit test cannot prove.

## Re-extraction safety

| Requirement | Test |
|---|---|
| Approved item survives force re-extraction | `apply_vision_extraction_takeoff_items keeps decided items untouched...` (Milestone 1) |
| Rejected item survives force re-extraction | `a rejected item also survives force re-extraction (not just approved)` (new) |
| Suggested item may be replaced | `apply_vision_extraction_takeoff_items keeps decided items untouched...` (Milestone 1) |
| Reviewed item may be replaced | `a reviewed (but undecided) item may be replaced, same as suggested` (new) |
| No orphaned estimate_item after replacement | `no orphaned estimate_item remains after a suggested/reviewed row is replaced` (new) |
| Audit history records superseded items | `apply_vision_extraction_takeoff_items keeps decided items untouched...` (asserts a `deleted` history row) |
| Concurrent refresh does not duplicate or lose rows | `concurrent re-extraction calls for the same page do not duplicate the same finding` (new) |
| Mid-operation failure rolls back the entire operation | `a mid-operation failure rolls back the entire re-extraction (atomicity)` (new) |

## Correct item targeting

| Requirement | Coverage |
|---|---|
| Each displayed result includes its exact takeoff_item_id | Structural — `fetchVisionTakeoffItems` returns `Record<item_key, TakeoffItemRef>`; `VisionExtractionsPanel`'s `enriched` memo attaches `takeoffRef` (containing `id`) per finding by content key, not index. No array-position code path remains (verified by code inspection during the adversarial review, `ACCEPTANCE_RESULTS.md`). |
| Approving item A cannot approve item B | Same content-key mechanism — `review()` always calls `it.takeoffRef!.id`, which is the exact row id matched by key, not by position. |
| Different database ordering does not change behavior | The lookup is `Record<key, ref>` (a hash map), not an ordered array — DB row order is irrelevant to the lookup by construction. |
| Partial insert failure does not misalign rows | Covered by the atomicity test above — a partial failure rolls back entirely, so there is never a state with some-but-not-all rows inserted for a single re-extraction call to misalign against. |

## Authorization

| Requirement | Test |
|---|---|
| Cross-tenant approval denied | `cross-tenant approval is denied...` (Milestone 1) |
| Cross-project approval denied where required | No such requirement is enforceable today — no project-membership system exists (see `AUTHORIZATION_REVIEW.md`). Pinned down instead by `documents the current cross-project approval scope...` (new), which asserts today's actual (tenant-wide) behavior so a future change is a visible diff, not a silent regression. |
| Client-supplied IDs cannot bypass authorization | `a client-supplied tenant_id in the request body cannot bypass tenant scoping...` (new) |

## Performance

| Requirement | Coverage |
|---|---|
| Bulk history insertion uses one batch operation | `recordTakeoffHistoryBatch` (Milestone 1) — one `.insert(entries.map(...))` call regardless of batch size; exercised by the existing `preserves an edit's before/after state...` test. |
| JSONB lookup uses the intended index | `idx_takeoff_items_meta_gin` (Milestone 1) exists live — confirmed via `pg_indexes` query against the live project. No query-plan (`EXPLAIN`) assertion is included in the automated suite; this is a static schema check, not a per-request behavioral test. |
| Re-extraction remains performant on a large page-result set | Not load-tested in this pass — the function's cost is O(n) in the number of extracted findings per page (one loop, no nested per-item subqueries beyond the single decided-keys array lookup done once up front), and real vision-extraction pages are bounded to whatever a single Gemini call returns (tens of findings, not thousands). Flagged as a non-blocking assumption in `REMAINING_RISKS.md` rather than fabricating a synthetic load test that wouldn't reflect real usage. |

## Test run results

33/33 passing (25 pre-existing + 8 new this milestone). See
`ACCEPTANCE_RESULTS.md` for the full run output and independent adversarial
review findings.

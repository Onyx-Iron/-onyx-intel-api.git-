# Acceptance Results — Takeoff Integrity Hardening (Milestone 1.2)

## Definition-of-done checklist

| Criterion | Status | Evidence |
|---|---|---|
| Approved/rejected decisions survive re-extraction | PASS | `apply_vision_extraction_takeoff_items keeps decided items untouched...`, `a rejected item also survives force re-extraction...` |
| No estimate rows become orphaned | PASS | `no orphaned estimate_item remains after a suggested/reviewed row is replaced` — proven both by the review-status gate (suggested/reviewed rows are never synced) and by `ON DELETE SET NULL` on `estimate_items.source_takeoff_id` as a second layer |
| Approve/Reject always targets the correct item | PASS | Content-key-based `Record<item_key, TakeoffItemRef>` lookup (structural fix, re-verified by the adversarial review — no array-index code path remains) |
| Replacement logic is atomic or safely idempotent | PASS | Atomic: `a mid-operation failure rolls back the entire re-extraction (atomicity)`. Idempotent: `concurrent re-extraction calls for the same page do not duplicate the same finding` (see caveat below) |
| Audit history remains complete | PASS | `deleted` history row asserted for every purge; `recordTakeoffHistoryBatch` batches multi-row writes |
| Cross-tenant access denied | PASS | `cross-tenant approval is denied...`, `a client-supplied tenant_id in the request body cannot bypass tenant scoping...` |
| Cross-project access denied "as required" | DOCUMENTED, NOT ENFORCED | No project-membership system exists in the schema (see `AUTHORIZATION_REVIEW.md`) — the brief's own instruction was "do not invent a new role system" if none exists, so this is a documented, tested, intentional gap, not a silent omission |
| Tests pass | PASS | 33/33 (25 pre-existing + 8 new) |
| Production build passes | PASS | `next build` completed with no errors |
| Independent validation finds no critical defect | PASS | See below |

## Validation run

- `npx tsx --test lib/estimating/*.test.ts` → **33 pass, 0 fail** (6 suites → 7 with the new authorization describe block).
- `npx eslint lib/estimating/takeoff-integrity.integration.test.ts` → clean, no output.
- `npx tsc --noEmit` → no new errors introduced; all remaining errors are pre-existing and unrelated (`lib/agents/tenantGuard.ts`/`agent_runs`, `lib/validation.ts`, `cut_fill_*` types, `CADVectorLayer.tsx`/`SheetCanvas.tsx` pdfjs-dist API mismatches, Deno edge-function type errors) — confirmed by re-running the same typecheck and diffing the file list against the previous milestone's baseline.
- `npx next build` → succeeded, all routes compiled.
- Migration validation: both migrations applied live to the Supabase dev project (`vvnigrbdsipriufhrwbs`) via the Supabase MCP `apply_migration` tool and confirmed present in `list_migrations` output (`takeoff_vision_extract_idempotent_insert`).
- Database constraint check: `idx_takeoff_items_undecided_page_item_key` confirmed live via direct `pg_indexes` query — a partial unique btree index on
  `(tenant_id, document_id, meta->>'vision_page_id', meta->>'item_key') WHERE review_status IN ('suggested','reviewed')`.

## Independent adversarial review (this milestone's fixes only)

A second, independent review pass (fresh context, told to assume the implementation might be wrong) specifically targeted the two areas most likely to hide a subtle defect:

1. **Does the `ON CONFLICT` clause exactly match the partial unique index's expression list and predicate?** Checked character-by-character — yes, exact match on both the four-column expression list and the `WHERE review_status IN ('suggested','reviewed')` predicate. A mismatch here would have caused every insert to throw at runtime; confirmed no mismatch.
2. **Does the "mid-operation failure rolls back" test actually exercise rollback, or could the malformed input be rejected before the function body runs (making the test trivially true)?** Traced the type path: `p_items` is `jsonb`, so PostgREST/Postgres accepts the malformed string field without pre-validation; the `::numeric` cast failure only happens inside the loop, after the delete-and-log step has already run in the same transaction. Confirmed the test genuinely exercises transactional rollback.
3. **`IF FOUND` semantics** — confirmed `FOUND` correctly reflects only the immediately-preceding `INSERT ... ON CONFLICT DO NOTHING` (no interleaving statement between insert and check), so it can't be stale from a prior loop iteration.
4. **Tenant/document/page scoping** — confirmed every query in the route still includes `.eq("tenant_id", tenantId)`.

No confirmed bugs found. One honestly-reported caveat, not a bug: the concurrency test's overlap between the two `Promise.all` RPC calls is a real (separate HTTP requests, separate DB connections) but probabilistic race — it is not a guaranteed repro on every single run the way a deterministic unit test would be. The correctness guarantee itself (the unique index + `ON CONFLICT DO NOTHING`) is unconditional regardless of whether any given test run happens to trigger the race window; the test is a best-effort confirmation of that guarantee, not the source of the guarantee. See `REMAINING_RISKS.md`.

## Recommendation

Safe to merge. No critical or high-severity defect survived this milestone's fixes or the independent adversarial re-check.

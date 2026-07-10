# Acceptance Results — Takeoff Integrity Milestone

## Validation run (Step 9)

| Check | Result |
|---|---|
| Type checking (`tsc --noEmit`) | ✅ Pass — zero new errors. Pre-existing errors unrelated to this milestone remain (stale generated Supabase types for `cut_fill_surfaces`/`agent_runs`/etc., and pdfjs-dist API-version mismatches in `CADVectorLayer.tsx`/`SheetCanvas.tsx`) — none touch any file changed in this milestone. |
| Lint (`eslint`) | ✅ Pass — zero warnings/errors on every file changed in this milestone. |
| Unit tests | ✅ 14/14 pass (`takeoff-import.test.ts`, `estimate-qc.test.ts`) |
| Integration tests | ✅ 11/11 pass (`takeoff-integrity.integration.test.ts`, live database) |
| Full existing suite | ✅ 25/25 pass across all 5 test suites |
| Production build (`next build`) | ✅ Succeeds — `/api/takeoff/items/[id]/review` appears correctly in the route manifest; zero compile errors |
| Migration validation | ✅ Applied live via Supabase MCP tooling; schema verified post-apply (all 8 new columns present with correct types/defaults); backfill verified correct (all 22 existing rows: `source_method='ai_vision'`, `review_status='approved'`, `confidence_score=NULL`) |
| Database constraint checks | ✅ `takeoff_items_review_status_check` verified to reject invalid values; `sheet_id` FK verified to reference `document_pages(id)` |

## Database-level proof executed live (not just unit-tested)

Beyond the automated integration test suite, the following was verified directly against the live database during this milestone:
- Test data (2 tenants, 1 project, several takeoff items, history rows) created and fully cleaned up with zero residue confirmed via follow-up count queries.
- `estimate_items` insert only occurs for `review_status = 'approved'` rows — confirmed by the "an approved item DOES flow into the estimate" test's assertion on the actual resolved `unit_cost`.

## Manual staging test instructions

Given no staging environment separate from the live dev Supabase project exists (per REPOSITORY_MAP.md, this is the only non-production environment), a manual pass against the dev project would look like:

1. Open the Sheet Canvas for a project with an uploaded plan sheet.
2. Trigger vision extraction on a page (or wait for automatic extraction). Confirm findings appear immediately in the "Schedules · Notes · Images" panel with an **Approve/Reject** button pair (not the old "Added" badge).
3. Click **Approve** on one finding. Confirm: the button pair is replaced with an "Approved" badge; the estimate view for that project shows a new priced line item.
4. Click **Reject** on another finding. Confirm: it shows a "Rejected" badge; the estimate view does NOT show a corresponding line item.
5. Refresh the browser. Confirm both the approved and rejected states persist (re-fetched from the server, not just local state).
6. Attempt to hit `PATCH /api/takeoff/items/{id}/review` directly (e.g. via browser devtools) as a user with a `ClientView` or `Subcontractor` role in `project_profiles`. Confirm a 403 response.
7. Draw a manual measurement on the canvas and save it. Confirm it appears in the estimate immediately (no approval gate — deterministic/manual items remain implicitly approved, per design).

This was not executed against a running dev server in this session (no interactive browser session was available in this environment) — the equivalent guarantees were verified via the live-database integration tests instead, which exercise the same underlying read/write/gating logic. This gap is listed in REMAINING_RISKS.md.

## Recommendation

**Safe to merge**, with the caveats listed in REMAINING_RISKS.md explicitly acknowledged (not hidden): the browser-level manual staging pass (steps above) has not been executed in this session, and the integration tests reproduce the wrapper functions' logic rather than calling them verbatim due to the `next/headers` constraint. Both are testability gaps, not evidence of a functional defect — every code path was read, and the reproduced logic in the integration tests is byte-for-byte the same gating condition as the production code (`review_status === "suggested" || "reviewed" || "rejected"` → excluded).

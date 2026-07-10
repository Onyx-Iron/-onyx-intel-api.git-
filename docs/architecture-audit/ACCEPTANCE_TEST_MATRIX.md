# Acceptance Test Matrix

Current automated coverage: 7 pure-unit-test files (6 TypeScript via `node:test`, 1 Python), all testing in-memory helper functions only. **Zero integration tests exist for any workflow below.** No test runner is wired into `package.json` (`node --test` must be invoked manually), and there is no CI gate running any of them today.

| Workflow | Current automated coverage | Required acceptance criteria (per "Definition of Done") | Test type needed |
|---|---|---|---|
| Document upload/processing | None | Upload → document record created → sheet split → OCR/vector-extracted → survives refresh → failure states visible, not silent | Integration (route + Edge Function) |
| Manual takeoff save | Fingerprint/dedup helper only (`takeoff-import.test.ts`) | Saved item persists tenant/project/document/geometry/scale/unit/quantity/creator; survives refresh; edit/delete work; estimate reflects the change | Integration (route + DB) |
| AI/vector takeoff extraction | CSI-classification helper only (`test_takeoff_extract.py`) | Extracted quantity cites its source; AI-vision items are excluded from estimate totals until reviewed (see D-03); confidence/source visible in UI | Integration (Python + Next.js route) |
| Estimate creation | Estimate-QC rollup helper only (`estimate-qc.test.ts`) | Estimate persists with correct cost fields; creation is audited; totals match the stated markup/margin convention | Integration (route + DB) |
| Estimate-to-takeoff sync | Fingerprint/import helper only (`takeoff-import.test.ts`) | `syncTakeoffToEstimate` correctly dedupes, prices, and inserts; Node and Deno implementations produce identical results for the same input (D-10) | Integration (DB-level) |
| Contact creation/extraction | None | Duplicate contact triggers a warning; extracted contacts require explicit human approval before becoming verified; project-specific role persists correctly | Integration (route + DB) |
| RLS / tenant-isolation enforcement | None | A request scoped to tenant A cannot read/write tenant B's rows, independent of whether the application-code filter is present (i.e., proves D-01 is fixed, not just that today's routes happen to filter correctly) | Integration, ideally run against the anon/RLS-subject client directly, not just the service-role path |
| Auth/authorization | None | Every mutating route requires a valid session; role-gated actions (financial/admin) are blocked for unauthorized roles across ALL routes the permission matrix should cover, not just the 4 it's wired into today | Integration |

## Recommended minimum test set for the first repair milestone (see RECOVERY_ROADMAP.md)

1. A test proving tenant isolation holds even if a route's application-level filter is accidentally removed (this either requires migrating a code path to the RLS-subject client, or is a permanent structural limitation to document explicitly if the service-role design is kept).
2. An integration test for `syncTakeoffToEstimate` end-to-end (DB write → estimate row correctly priced and deduped).
3. An integration test proving an `estimate_items` row with `pricing_status: "review"` is excluded from at least one real downstream total/export (whichever is built first).
4. A CI workflow (even minimal: `tsc --noEmit` + `eslint` + `node --test` on the 7 existing files) gating merges, so this list doesn't silently grow stale again.

# Implementation Plan — Takeoff Integrity Milestone

## Existing assets identified before writing any code

**Tables:** `takeoff_items` (22 live rows, ai_vision-sourced, already `approved` from a prior session commit), `manual_takeoffs`, `civil_pipe_runs`/`civil_stockpiles`/`civil_construction_entrances`/`civil_utility_takeoffs`, `estimate_items`, `document_pages`, `projects`, `tenants`, `cost_codes`/`cost_catalog`.

**Constraints:** `takeoff_items_tenant_id_fkey`/`takeoff_items_project_id_fkey` (CASCADE), `takeoff_items_document_id_fkey` (SET NULL), `estimate_items_source_takeoff_id_fkey` (SET NULL), a pre-existing `review_status` CHECK (`pending_review`\|`approved`\|`rejected`, added by a prior commit this session) that this milestone widens.

**API routes:** `app/api/takeoff/items/route.ts` (GET/POST/DELETE, the main manual/deterministic write path), `app/api/takeoff/canvas/manual/route.ts`, `app/api/takeoff/canvas/vision-extract/route.ts`, `app/api/takeoff/canvas/utility/route.ts`, `app/api/earthwork/{pipe-runs,stockpiles,entrances}/route.ts`, `app/api/takeoff/items/[id]/review/route.ts` (created by the immediately-prior commit, extended here).

**Frontend components:** `components/takeoff/canvas/SheetCanvas.tsx`, `components/takeoff/canvas/VisionExtractionsPanel.tsx`, `components/takeoff/TakeoffTab.tsx`.

**Calculation functions:** `lib/math/civil-scope.ts` (`calcPipeEmbedment`, `calcStockpile`, `calcConstructionEntrance` — real deterministic engineering math, unaffected by this milestone), `takeoff_extract.py`'s `CSI_RULES` classifier and PDF/DXF/IFC/XLSX quantity extraction (unaffected).

**Audit utilities:** `lib/activity.ts` (`logEvent` — coarse UI activity feed, kept as-is), `lib/audit.ts` (`auditInsert`/`auditUpdate`/`auditDelete` — generic before/after JSON blob to `audit_logs`, used elsewhere in the app but NOT reused here because `takeoff_item_history` needs a `takeoff_item_id`-keyed, cheaply-queryable-per-item shape that the generic `audit_logs` table doesn't provide), `lib/takeoff/history.ts` (created by the immediately-prior commit — `recordTakeoffHistory`, reused and extended by this milestone).

**RLS policies:** all `takeoff_*` and `civil_*` tables have `tenant_isolation` policies (see DATABASE_AUDIT.md) — real and correctly defined, but not load-bearing for actual app traffic since every route uses the service-role client (AUTHORIZATION_AUDIT.md's central finding). This milestone does not change that architecture (explicitly out of scope per Step 7's instructions) — it adds application-layer verification instead (see AUTHORIZATION_MODEL.md).

## Exact files changed

- `portal/supabase/migrations/20260723_takeoff_integrity_data_model.sql` (new migration)
- `portal/lib/estimating/takeoff-import.ts` — widened `review_status` type/gate to the 4-state lifecycle
- `portal/lib/estimating/takeoff-import.test.ts` — added/renamed tests for the new states
- `portal/lib/estimating/auto-sync.ts` — no functional change needed this pass (already selects `review_status`; gate lives in `buildEstimateImportRows`)
- `portal/lib/estimating/civil-mirror.ts` — added `sheet_id`, `source_method`
- `portal/app/api/takeoff/items/route.ts` — added `updated_by`, `source_method`, and `assertProjectBelongsToTenant` verification on POST
- `portal/app/api/takeoff/canvas/manual/route.ts` — added `assertProjectBelongsToTenant` verification (closing the exact gap AUTHORIZATION_AUDIT.md flagged for this route), `sheet_id`, `source_method`
- `portal/app/api/takeoff/canvas/vision-extract/route.ts` — renamed `pending_review`→`suggested`, added `source_method`, `confidence_score`, `sheet_id`, explicit `geometry: null` + `meta.geometry_unavailable`
- `portal/app/api/takeoff/canvas/utility/route.ts`, `portal/app/api/earthwork/{pipe-runs,stockpiles,entrances}/route.ts` — added `assertProjectBelongsToTenant` verification
- `portal/app/api/takeoff/items/[id]/review/route.ts` — added the `"review"` action (→ `reviewed` state), `approved_by`/`approved_at`, and `assertPermission(tenantId, userId, "financial", "write")` gate
- `portal/components/takeoff/canvas/VisionExtractionsPanel.tsx` — updated state vocabulary (`suggested`/`reviewed` both render as "needs decision")
- `portal/supabase/functions/page-takeoff-worker/index.ts` — mirrored all of the above in the Deno runtime (deployed live, version 10)
- `portal/lib/estimating/takeoff-integrity.integration.test.ts` (new) — live-database integration tests

## Migration

One file, `20260723_takeoff_integrity_data_model.sql` (see MIGRATION_PLAN.md for the full rollback/backfill plan). Builds on `20260722_takeoff_governance_review_workflow.sql` (the immediately-prior commit's migration, which added the original `review_status`/`takeoff_item_history` foundation this milestone extends rather than replaces).

## Tests added

- 5 new pure-unit tests in `takeoff-import.test.ts` (suggested/reviewed/rejected/approved/legacy-null gating)
- 11 new live-database integration tests in `takeoff-integrity.integration.test.ts` (persistence, audit history, review-status gating end-to-end, tenant/project isolation) — see TEST_PLAN.md for full rationale and ACCEPTANCE_RESULTS.md for results.

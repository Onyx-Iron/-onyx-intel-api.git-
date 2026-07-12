# Implementation Summary

## New files
- `supabase/migrations/20260726_estimating_core_consolidation.sql` — schema + trigger + data migration.
- `lib/estimating/calculations.ts` — deterministic cost/markup/margin calculations.
- `lib/estimating/versioning.ts` — version lifecycle helpers (`loadVersionForTenant`, `assertVersionEditable`, `createDraftFromVersion`, `approveVersion`, `getOrCreateDraftVersion`, `recalculateVersionTotals`).
- `lib/estimating/audit.ts` — `estimate_audit_log` writer (batched, mirrors `lib/takeoff/history.ts`).
- `app/api/estimate/versions/route.ts` — list/create estimate + version.
- `app/api/estimate/versions/[id]/route.ts` — GET (items + server-recalculated totals), PATCH (bulk item upsert + version-percentage update, draft-only), DELETE (single item, draft-only).
- `app/api/estimate/versions/[id]/approve/route.ts` — approve a draft/review version.
- `app/api/estimate/versions/[id]/proposal/route.ts` — generate a proposal snapshot from an approved version (or an explicit draft preview).
- `app/api/estimate/versions/[id]/sov/route.ts` — generate a Schedule of Values from the same version.
- `app/api/estimate/versions/[id]/buyer-adjustment/route.ts` — two-step (preview → confirm) buyer-specific percentage adjustment.
- `lib/estimating/calculations.test.ts` — 17 unit tests.
- `lib/estimating/estimate-versioning.integration.test.ts` — 5 live-database integration tests.
- `docs/milestones/estimating-core-consolidation/` — this deliverable set.

## Modified files
- `lib/estimating/auto-sync.ts` — now resolves/creates the project's current draft version via `getOrCreateDraftVersion`, dedups across every version of the one estimate, maps resolver cost-category breakdown (when available) into `labor_cost`/`material_cost`/`equipment_cost`, and applies version-level percentages via `applyVersionPercentages` before writing.
- `app/api/estimate/matrix/route.ts` — POST/PATCH/DELETE retired (410 Gone); GET unchanged (historical read).
- `app/api/estimate/matrix/seed/route.ts` — rewritten to write into `estimate_items` (via `getOrCreateDraftVersion`) instead of the deprecated `project_estimates`.
- `components/estimate/EstimateMatrix.tsx` — rewired to `/api/estimate/versions/*`; added version/status badge, "New Draft to Edit" / "Approve Version" buttons, a locked-version banner; per-unit-rate grid UI otherwise unchanged.

## Not built (explicitly out of scope per the brief)
- A dedicated version-diff/compare endpoint (satisfied structurally — see `VERSIONING_MODEL.md`).
- Full buyer-adjustment coverage for retainage/bond/admin-burden/payment-risk (no dedicated columns exist for these yet — only the three percentage fields that already exist on `estimate_versions` are covered; see `REMAINING_RISKS.md`).
- Assemblies-to-cost-category auto-resolution beyond what `lib/cost/resolver.ts` already provides (labor/material/equipment split when the resolver has one; a single material-cost bucket fallback otherwise, documented not fabricated).
- Any new project-level membership/permission system (per the brief's own "do not invent a new role system" instruction — same finding and same decision as the prior takeoff-integrity-hardening milestone).

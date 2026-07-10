# Recovery Roadmap

Recommended order of repair, derived from the Defect Register. Ordering logic: fix what's actively dangerous first, then what blocks correct estimating (the stated first product priority), then reliability, then hygiene.

## Milestone 1 — Stop the bleeding (P0s + highest-leverage P1s)

1. **D-02 — Reconcile the 9 loose SQL files and the migration-count gap.** This already caused one real production incident and is the cheapest, most urgent fix (pure investigation + archival/reconciliation, no new code). Do this first because every other milestone below assumes the schema audit trail is trustworthy.
2. **D-01 — Decide and document the RLS/service-role posture.** Either commit to migrating key routes to the RLS-subject client, or formally document that tenant isolation is application-code-enforced-only and add automated tests/lint rules as the real backstop instead. This is a decision + a test (Acceptance Test Matrix #1), not necessarily a large migration — but it must be decided before building anything else that assumes RLS is protecting it.
3. **D-11 — Add audit logging to tenant creation, estimate creation, and cost-override changes.** Small, mechanical fix, high compliance value, unblocks nothing else but should not wait.

**Files to change in Milestone 1:** `portal/lib/audit.ts` call sites in `app/api/estimate/route.ts`, `app/api/cost-catalog/overrides/route.ts`, `portal/lib/project-controls/server.ts`; a reconciliation pass (no code, mostly investigation + possibly one cleanup migration) over `schema.sql`, `portal/supabase-schema.sql`, `portal/supabase-migration-v2.sql`–`v9.sql`.

## Milestone 2 — Estimating foundation (matches the product's own stated first priority)

4. **D-04 — Consolidate the two estimate systems.** This is the highest-leverage fix in the entire register: nearly every other estimating defect (D-05 versioning, D-06 budget conversion, D-07 markup/margin) is easier to fix once there's one authoritative estimate table with the full cost-field split.
5. **D-05 — Add estimate versioning** as part of the same consolidation work.
6. **D-07 — Fix the markup/margin conflation** in the (now-consolidated) proposal/SOV export.
7. **D-08 — Complete `takeoff_items` schema** (document version, sheet revision, geometry, scale, assembly, creator, approval status) so the consolidated estimate system has real source traceability to link against.
8. **D-03 — Resolve the AI-vision auto-approval question.** Either restore a hard gate, or verify and lock in that `pricing_status: "review"` is genuinely enforced as an exclusion filter everywhere the now-consolidated estimate system computes totals/exports.

**Files to change in Milestone 2:** `app/api/estimate/*`, `app/api/estimate/matrix/*`, `lib/estimating/auto-sync.ts`, `lib/estimating/civil-mirror.ts`, `portal/supabase/functions/page-takeoff-worker/index.ts` (D-10's duplicated logic should be reconciled here too), `portal/components/estimate/EstimateMatrix.tsx`, `portal/app/api/takeoff/items/route.ts`, `portal/app/api/takeoff/canvas/vision-extract/route.ts`, relevant migrations.

## Milestone 3 — Estimate-to-execution handoff

9. **D-06 — Build a real `budgets` table and estimate-to-budget conversion.** Depends on Milestone 2's consolidated, versioned estimate as its source.

## Milestone 4 — Reliability and observability

10. **D-12 — Fix the whole-document ingest silent-hang risk.**
11. **D-13 — Surface page-level processing failures at the document level.**
12. **D-15 — Add a minimal CI gate** (tsc + eslint + existing 7 tests).
13. **D-16 — Add minimal error-tracking**, prioritizing the 4 Edge Functions (currently zero failure visibility beyond manual log reading).

## Milestone 5 — Contact/Company foundation (only once Milestones 1-4 are stable, per the product's own stated sequencing)

14. **D-09 — Add a `project_contacts` relationship table and basic duplicate detection** — the minimum viable step toward the spec's Domain 2 requirements, without attempting the full merge/verification/communication-history system in one pass.

## Milestone 6 — Hygiene (can be interleaved opportunistically, no urgency)

15. D-14 (regenerate `.env.example`), D-17 (consolidate redundant RLS policies), D-18 (revoke dead-table GraphQL exposure), D-19 (remove confirmed-dead legacy files), D-20/D-21 (dependency verification).

## What this roadmap deliberately does not include

Per the audit's scope instructions and the product's own stated sequencing: Domains 3-5 (property/parcel intelligence, market analysis, underwriting/pro forma) are correctly, deliberately not part of this roadmap. Marketplace/advertising/broad CRM expansion beyond the minimum Milestone 5 step are also out of scope for this repair sequence.

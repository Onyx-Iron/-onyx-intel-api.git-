# Current Architecture — Summary

This document synthesizes the full audit (see the other 12 documents in this directory for source detail and citations). It is descriptive, not prescriptive — no recommendations are made here beyond what RECOVERY_ROADMAP.md covers separately.

## What Onyx Intel actually is today

A Next.js 16 app (`portal/`, deployed to Vercel) backed by Supabase Postgres (76 tables) and Storage, calling out to a Python FastAPI service (Railway) for deterministic + AI-vision takeoff extraction, with Clerk for authentication and 4 Supabase Edge Functions handling async document processing. See REPOSITORY_MAP.md and SERVICE_DEPENDENCY_MAP.md for full detail.

## Maturity by area (most to least complete)

1. **Civil/vertical CSI classification and deterministic takeoff math** — genuinely strong. Real geometry-derived quantities from PDF tables, DXF vectors, IFC BIM data, and XLSX cells, each citing its literal source.
2. **Document splitting/OCR/embedding async pipeline** — real retry logic, real per-page failure isolation — but silent partial-failure modes exist (embed failures marked "done," page-level takeoff failures invisible at the document level).
3. **Manual/AI-assisted takeoff capture** — functional end-to-end, but `takeoff_items` (the estimate-facing table) is missing document-version, sheet-revision, geometry, scale, assembly, creator, and approval-status fields that exist upstream on the source tables and are lost in the mirror step.
4. **Estimating** — two parallel, disconnected systems (`estimate_items` flat/blended-cost vs. `project_estimates` matrix with full cost splits), no versioning on either, a confirmed markup-vs-margin calculation bug, and no estimate-to-budget conversion.
5. **Contact/Company intelligence** — a real but shallow seed (flat CRUD + a standalone AI-paste-and-extract tool); none of the relationship modeling, dedup, merge, or source-traceability infrastructure the product spec treats as foundational exists yet.
6. **Authorization** — tenant isolation is real in application code today, but RLS (the intended database-level backstop) is never actually evaluated because every route uses the service-role client. A narrower role/permission system exists but is wired into only 4 of the routes it should cover.
7. **Testing/CI/observability** — 7 pure-unit-test files covering estimating/takeoff *helper functions* only; zero integration tests; no CI gate of any kind between push and production deploy; no error-tracking service; console-log-only observability.

## The five most consequential cross-cutting patterns

1. **RLS is decorative.** 91/121 routes use the service-role client; zero use the RLS-subject anon client. Tenant isolation depends entirely on every route remembering its own filter, with no database-level enforcement backstop.
2. **Two estimate systems, not one authoritative record** — directly violates the product rule "maintain one authoritative project record" as applied to estimates.
3. **No versioning anywhere** — estimates, underwriting (not yet built), and documents/sheets all mutate in place with only a fire-and-forget audit-log blob as the recovery mechanism.
4. **AI-vision takeoff auto-commits to the estimate** with only a soft status-flag review marker, not a hard approval gate — a confirmed deviation from "no AI-generated quantity may automatically become an approved estimate quantity."
5. **Untracked schema-change risk remains live** — 9 loose SQL files outside the migrations directory, and a ~12-migration gap between what Supabase has applied and what's checked into the repo. This is the exact pattern that already caused one real production incident (the `v7` migration) this session.

## Is the system recoverable?

Yes. None of the findings above represent architectural dead ends — they are gaps and inconsistencies in a system whose core domain logic (CSI classification, deterministic quantity math, cost resolution precedence, tenant-scoped application-layer authorization) is genuinely well-built. The highest-leverage repairs are additive (a real estimate-versioning table, a budget table, an RLS-enforcement audit, a takeoff_items schema completion) rather than requiring a rewrite of working subsystems. See RECOVERY_ROADMAP.md for the recommended order of repair.

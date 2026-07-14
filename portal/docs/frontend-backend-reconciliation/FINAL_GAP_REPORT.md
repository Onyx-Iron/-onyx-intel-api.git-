# Final gap report — frontend/backend reconciliation (Phases 1–6)

Branch `feature/frontend-backend-reconciliation`, PR #4 (draft, undeployed).
This report separates what's real and working from what's genuinely missing,
across the whole engagement — not just Phase 4.

## Working (real backend, wired, verified)

| Area | Evidence |
|---|---|
| Command Center | Deduplicated single implementation, tenant-wide |
| Takeoff (project + global) | Canvas, vector extraction, calibration, quantity math — 33 unit tests passing |
| Estimating (project + global) | Full matrix, roll-up math, QC report — 17 unit tests passing |
| Documents | Upload, Drive picker, split/OCR/vector/takeoff pipeline, per-stage status UI, now with real `last_error`/`last_error_step` wiring |
| Contacts & Companies, Price Book | Real tables/APIs, project-scoped |
| Procurement (project + global) | RFQ → vendor bid → award → PO, tenant-isolation bug fixed (`purchase_orders` was missing `tenant_id` filter), 6/6 integration tests |
| Civil Intelligence (project + global cut/fill only) | Real mass-haul math; pipe runs/entrances/stockpiles/material ledger remain project-only (see gap below) |
| Financials (project + global) | Invoices (AR/AP) + lien waivers, financial-read redaction closed on both endpoints |
| Project Controls (RFIs/Submittals/Change Orders) | Confirmed live in Phase 1, 10/10 integration tests |
| AI Workforce | Tenant-wide agent approval feed, real audit trail, already fully wired before this engagement touched it |
| Marketing | Tenant-wide campaigns/leads, already fully wired |
| Schema/migrations | Empty-DB replay reproduces production exactly (88=88 tables, identical security-advisor findings); 9 legacy pre-CLI SQL files reconciled |
| Integration test safety | Guard fails closed against production, isolated branch confirmed working, 21/21 passing, zero residual data |
| TypeScript/lint | Zero errors, zero warnings-that-are-errors, across the whole portal (excluding Deno Edge Functions, which are a different runtime) |
| Env var handling | Fails closed with a clear message instead of silently forwarding blank values (the recurring class of bug behind a prior production incident) |

## Partially working (real backend, incomplete scope)

| Area | What's real | What's missing |
|---|---|---|
| Civil Intelligence | Cut/fill volumes globally | Pipe runs, construction entrances, stockpiles, material ledger are project-only — each has a real table/API but wasn't rolled into the global workspace (documented in `PHASE_4_GAP_ANALYSIS.md`) |
| Document processing observability | `last_error`/`last_error_step` now populated by the ingest route and the split-worker Edge Function | `page-processor` (OCR stage) and `page-takeoff-worker` Edge Functions were not audited/fixed this pass for the same class of bug — only the two paths actually exercised by this engagement's changes were verified. The dedicated `document_processing_events` per-step log table exists in the schema but nothing writes to it anywhere |
| Billing | Checkout and Paddle webhook price-tier resolution were both silently broken (iterating an array as if it were a keyed object) and are now fixed | Never load-tested against a real Paddle sandbox event in this engagement — fixed by code inspection + the type system, not an end-to-end webhook replay |

## Unavailable (no real backend — correctly left "Coming Soon")

| Workspace | Why | What it needs |
|---|---|---|
| Preconstruction | No `bid_opportunities`/pipeline concept exists in the schema at all | New table + API + workspace (net-new scope) |
| Project Management (global roll-up) | Data exists (RFIs, submittals, change orders, schedule, daily/weekly logs, punch list, staff all real per-project) but nothing aggregates it tenant-wide | One new aggregation route + page across 7 tables |
| Reports | Only `/api/status-report` exists — a one-shot, non-persisted AI text summary | `report_runs` table, template selection, history/export |

Full detail for these three: `docs/frontend-backend-reconciliation/PHASE_4_GAP_ANALYSIS.md`.

## Verification performed this phase (Phase 5/6)

- **TypeScript**: `tsc --noEmit` — 0 errors (previously ~35, all either fixed or excluded as out-of-runtime-scope Deno files with a documented reason)
- **ESLint**: 0 errors, 30 pre-existing warnings (React hook deps, `<img>` usage) — none newly introduced, none block a clean run
- **Unit tests**: 78/78 passing (`npm run test:unit` equivalent via `tsx --test`)
- **Integration tests**: 21/21 passing against the isolated Supabase branch (`wjngtkkezeytyymamlmm`), re-run after all Phase 4/5 route changes, zero residual test data confirmed via direct query
- **Python takeoff service**: 2/2 tests (8 subtests) passing
- **Production build**: clean, all routes compile, run multiple times across this phase
- **Tenant isolation**: every tenant-scoped route audited — `tenantId` is always resolved server-side via `getOrCreateTenant(authTenantKey(userId, orgId), ...)` from Clerk's server-side `auth()`, never from a client-supplied `tenant_id`. Two intentional, explicitly-gated exceptions found and confirmed correct by design: `/api/admin/comp-access` (hardcoded super-admin email check) and `/api/procurement/bids` (deliberately unauthenticated public capability-link endpoint that resolves tenant_id via server-side DB lookup, never trusts client input)
- **Env var fail-closed**: added `lib/env.ts`, wired into both Supabase client constructors and the Gemini API key read; error messages never include the actual secret value

## Known limitation of this verification pass

**No real browser/visual testing was possible.** The Claude Preview MCP tooling is broken in this Windows environment (`spawn cmd.exe ENOENT`, confirmed on every attempt across this entire engagement, not something fixable from within this session). As a substitute:
- Started the dev server directly and confirmed every dashboard route (including all 3 new Phase 4 workspaces) returns the correct 307 auth-redirect rather than a 500, and the server log shows zero compile/runtime errors across all of them.
- The overflow-fade fix for the 10-section project nav pills was verified by code logic (measures actual `scrollWidth`/`clientWidth` via `ResizeObserver`) and a clean build, **not** by looking at it in a browser at each viewport width.

This means: desktop/laptop/tablet/mobile visual layout, empty/error/loading state *appearance*, and interactive form/permission behavior have **not** been eyeballed in a real browser this phase. Code-level review is a meaningfully weaker guarantee than seeing it render. If a browser-capable environment becomes available, this should be the first thing re-verified before considering the branch fully done.

## Recommendation

The branch is in a strong, honestly-documented state: real TypeScript/lint/test/build cleanliness, a verified tenant-isolation model, and no known regressions. The one open item that should block calling this "fully verified" rather than "verified as far as this environment allows" is the missing real browser pass.

# Final gap report — frontend/backend reconciliation (Phases 1–6)

> Current-state notice (2026-08-14): this is a historical phase report. Its
> old branch, test-count, browser-availability, and launch-readiness claims are
> superseded by `docs/LAUNCH_READINESS.md` and the fail-closed `npm run launch`
> evidence. In particular, takeoff certification, Paddle, preview/canary QA,
> and production migrations remain required release blockers.

Branch `feature/frontend-backend-reconciliation`, PR #4 (draft, undeployed).
This report separates what's real and working from what's genuinely missing,
across the whole engagement — not just Phase 4.

## 2026-08-04 launch-readiness update

The three workspaces below are now implemented in the current working tree and
no longer belong in the "Unavailable" bucket:

- Reports: persisted `report_runs`, `/api/reports`, `/api/reports/[id]`, and
  `/dashboard/reports` with generation history and Markdown export.
- Project Management: `/api/project-management/overview` and
  `/dashboard/project-management` aggregate RFIs, submittals, change orders,
  schedule tasks, daily/weekly logs, punch list, and staff across projects.
- Preconstruction: `bid_opportunities`, `/api/preconstruction/opportunities`,
  `/api/preconstruction/opportunities/[id]`, and
  `/dashboard/preconstruction` provide a real bid-pursuit pipeline.

Remaining launch blockers are operational/configuration items, not workspace
coverage gaps: replace Clerk test keys with production credentials, configure
Paddle live billing keys and price IDs, replay a Paddle sandbox/live webhook,
and do a real browser QA pass before opening sales access.

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

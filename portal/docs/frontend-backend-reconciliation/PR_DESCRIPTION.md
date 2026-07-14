# Frontend/backend reconciliation (Phases 1–6)

**Status: draft, not deployed, not merged.** Do not merge until a real
browser verification pass is done (see Known Limitation below).

## Summary

Full audit and reconciliation of the portal's frontend against its actual
backend capabilities, plus a from-scratch-reproducible production schema
baseline. Six phases:

1. **Audit** — mapped every workspace to its real routes/tables/APIs
2. **Front-loaded fixes** — procurement nav wiring, Command Center dedup,
   Change Orders re-investigation, financial-read redaction closure
3. **Global nav + Command Center + Takeoff/Estimating/Documents workspaces**
4. **Procurement/Civil Intelligence/Financials global workspaces** — built
   only where a real backend existed; Preconstruction/Project
   Management(global)/Reports correctly left "Coming Soon" with documented
   exact gaps
5. **Project workspace restructured** into 10 sections; responsive nav-pill
   overflow fix
6. **Final verification** — see below

## What's real and working

Command Center, Takeoff, Estimating, Documents (with pipeline status),
Contacts/Companies, Price Book, Procurement, Civil Intelligence (cut/fill),
Financials (invoices + lien waivers), Project Controls (RFIs/Submittals/
Change Orders), AI Workforce, Marketing — all tenant-isolated, all with a
real backend. Full detail: `docs/frontend-backend-reconciliation/FINAL_GAP_REPORT.md`.

## What's still "Coming Soon" (documented, not silently dropped)

Preconstruction, global Project Management roll-up, Reports — none have a
real backend to expose yet. Exact missing tables/APIs for each are in
`docs/frontend-backend-reconciliation/PHASE_4_GAP_ANALYSIS.md`.

## Migration/schema reconciliation

Production's schema was originally built from 9 loose hand-run SQL files
predating Supabase's CLI migration tracking. This branch adds a reproducible
baseline (`20260627000000_schema_baseline.sql` +
`20260812000000_baseline_foreign_keys_functions_and_triggers.sql` + two
migrations recovering untracked-but-real production RPC grants/RLS policies)
such that replaying this repo's migrations against an empty database now
reproduces production exactly — 88 tables, identical security-advisor
findings. Full detail: `docs/frontend-backend-reconciliation/MIGRATION_DRIFT_SWEEP.md`,
`MIGRATION_REPLAY_RESULTS.md`, `LEGACY_SCHEMA_RECONCILIATION.md`.

**No production migration ledger was touched.** All schema-baseline testing
happened on an isolated Supabase branch (`wjngtkkezeytyymamlmm`), never
against production.

## Test results

- **Integration**: 21/21 passing against the isolated branch, zero residual
  test data (verified by direct query after the run). See `TEST_RESULTS.md`.
- **Unit**: 78/78 passing.
- **Python takeoff service**: 2/2 (8 subtests) passing.
- **TypeScript**: 0 errors (`tsc --noEmit` exits 0) — includes fixing several
  real bugs the type system surfaced once a stale, hand-maintained partial
  Supabase types file (covering only 24 of ~60+ real tables) was regenerated
  from production: a completely broken Paddle billing price-tier lookup
  (checkout + webhook both iterated an array as if it were an object keyed
  by tier — never matched anything real), a `UniversalImportButton` that
  silently ignored a caller-supplied file-type restriction on 8 call sites,
  and a couple of smaller type/null-handling bugs.
- **ESLint**: 0 errors.
- **Production build**: clean.

## Security / safety notes

- Tenant isolation audited across every route touched this engagement:
  `tenant_id` is always resolved server-side from Clerk's `auth()`, never
  from client input. Two intentional exceptions confirmed correct by
  design (a hardcoded-email super-admin tool, and a deliberately
  unauthenticated public bid-submission endpoint that resolves tenant_id
  via server-side DB lookup) — both documented in `FINAL_GAP_REPORT.md`.
- Required environment variables now fail closed with a clear error message
  instead of silently forwarding a blank value into the Supabase client —
  this was the exact bug class behind a prior production incident
  (`NEXT_PUBLIC_SUPABASE_URL` blank in Vercel).
- No secret values are ever included in a thrown error message or logged.

## Known limitation — read before merging

**This verification pass could not include real browser/visual testing.**
The Claude Preview MCP tooling is broken in this Windows dev environment
(`spawn cmd.exe ENOENT`) for the entire engagement. As a substitute, the dev
server was started directly and every route (including all 3 new Phase 4
workspaces) was confirmed to return the correct auth-redirect with zero
server-side compile/runtime errors — but this is not equivalent to seeing
the UI render across desktop/laptop/tablet/mobile, or manually exercising
forms, empty/error states, and permission-gated views in a browser. That
pass should happen before this branch is considered fully done, not just
code-verified.

## Deployment requirements once merged

- `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` /
  `ALLOW_INTEGRATION_TESTS` secrets already added to CI for integration
  tests (see `.github/workflows/ci.yml`).
- The schema baseline migrations need to be applied to production via the
  normal Supabase migration deploy path — they were validated on an
  isolated branch, not yet applied to production.
- No other new environment variables introduced this engagement.

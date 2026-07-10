# Defect Register

Severity scale: P0 (security breach/data loss/complete blocker) · P1 (critical workflow failure) · P2 (serious reliability/accuracy problem) · P3 (usability/maintainability/performance) · P4 (enhancement/future improvement).

---

## P0

### D-01 — RLS is unenforced for all production traffic
**Affected workflow:** every tenant-scoped operation in the entire application.
**Affected files:** `portal/lib/supabase/server.ts` (`createServiceClient`), all 91 route.ts files calling it.
**Root cause:** every API route authenticates to Postgres as `service_role`, which bypasses RLS unconditionally by design. Zero routes use the anon/JWT-scoped client that RLS policies actually apply to.
**User impact:** none today (no known live leak).
**Data impact:** a single future route that forgets its `.eq("tenant_id", ...)` filter is a full, silent cross-tenant data leak with nothing in the database to stop it.
**Security impact:** critical — the intended defense-in-depth layer does not function.
**Recommended fix:** either (a) migrate reads to the anon/JWT-scoped client wherever feasible so RLS is actually load-bearing, or (b) formally accept service-role-everywhere as the design and invest instead in automated tenant-filter linting/tests for every new route, since RLS cannot be retrofitted as a backstop under the current architecture without a client-layer change.
**Dependencies:** none — can start immediately, but is a significant undertaking if pursuing (a).
**Acceptance test:** a route that omits its tenant filter must be caught either by RLS (if fixed) or by an automated test/lint rule (if the service-role design is kept).

### D-02 — Untracked, unreconciled schema-change risk (loose SQL files + migration count gap)
**Affected workflow:** all database-dependent workflows; already caused one real incident.
**Affected files:** `schema.sql`, `portal/supabase-schema.sql`, `portal/supabase-migration-v2.sql` through `v9.sql`.
**Root cause:** an early ad hoc "run this SQL by hand in the dashboard" workflow was superseded by `portal/supabase/migrations/` but the old files were never removed or reconciled; separately, Supabase's tracked migration count (53) exceeds the files present in the repo (41).
**User impact:** confirmed — this already caused a production error ("column estimate_items.source_takeoff_id does not exist") earlier this session, discovered only when a user hit it live.
**Data impact:** any developer editing schema by reading only the repo may act on an incomplete picture of the live schema.
**Security impact:** none directly, but security-relevant migrations could theoretically be among the untracked ~12.
**Recommended fix:** diff live schema against every file (loose + tracked), reconcile or archive the 9 loose files, and establish a rule that all schema changes go through the tracked migrations directory only.
**Dependencies:** requires Supabase schema access (already available via MCP tools).
**Acceptance test:** `portal/supabase/migrations/` file count and content, replayed against a fresh database, produces a schema identical to production.

---

## P1

### D-03 — AI-vision takeoff auto-approval gate removed
**Affected workflow:** AI/vector takeoff (canvas vision-extract path).
**Affected files:** `portal/app/api/takeoff/canvas/vision-extract/route.ts`.
**Root cause:** a session-earlier product decision replaced a hard manual-approval gate (item didn't exist in `takeoff_items` until a human clicked Approve) with automatic insertion + a soft `pricing_status: "review"` label.
**User impact:** an unverified AI-read quantity can reach a customer-facing estimate/proposal with no confirmed enforcement that "review"-status rows are excluded from totals/exports.
**Data impact:** estimate accuracy risk if the review flag isn't consistently honored downstream.
**Security impact:** none.
**Recommended fix:** either restore a hard gate (item doesn't exist in `estimate_items` until approved) or, if the automatic-commit UX is intentionally kept, add and verify a hard filter everywhere estimate totals/exports/PO generation touch `estimate_items` so `pricing_status: "review"` rows are provably excluded.
**Dependencies:** requires auditing every estimate-total/export code path (not yet done in this audit pass).
**Acceptance test:** an AI-vision-sourced line item must not appear in any generated proposal/SOV/PO total until its `pricing_status` is changed away from `"review"` by a human action.

### D-04 — Two disconnected estimate systems
**Affected workflow:** estimating end-to-end.
**Affected files:** `app/api/estimate/route.ts` + `lib/estimating/auto-sync.ts` (targets `estimate_items`) vs. `app/api/estimate/matrix/route.ts` + `app/api/estimate/matrix/seed/route.ts` (targets `project_estimates`).
**Root cause:** a newer, richer estimate data model (`project_estimates`, full labor/material/equipment/sub/trucking split) was built alongside the legacy flat model (`estimate_items`, one blended `unit_cost`) rather than replacing it, per the code's own comment ("so both live side by side").
**User impact:** data entered/synced into one system is invisible in the other; the resolver's labor/material/equipment split is computed then discarded before reaching `estimate_items`.
**Data impact:** estimate totals can differ depending on which system/view is consulted for the same project.
**Security impact:** none.
**Recommended fix:** pick one system as authoritative, migrate the other's live data into it, and retire the loser (per the "no duplicate sources of truth" product rule) — do not delete the losing system's code until the winner is proven per the "existing features must not be removed until replacements are proven" rule.
**Dependencies:** requires a product decision on which system to keep; likely `project_estimates` given its richer cost model, but the proposal/SOV exporter and dedup/fingerprint logic currently only exist against `estimate_items`'s ecosystem.
**Acceptance test:** a takeoff item synced once appears, correctly priced with its full cost split, in exactly one estimate view — not two, not zero.

### D-05 — No estimate versioning; changes are only recoverable via manual audit-log inspection
**Affected workflow:** estimating.
**Affected files:** `estimate_items`, `project_estimates` (both tables), `app/api/estimate/[id]/route.ts`.
**Root cause:** neither table has a version/snapshot column or companion history table; the only "history" is a fire-and-forget JSON blob written to `audit_logs` on update/delete.
**User impact:** an estimator cannot browse or restore a prior version of an estimate through the UI — recovery requires an engineer manually querying `audit_logs.old_values`.
**Data impact:** overwritten prices/quantities are only recoverable with direct database access.
**Security impact:** none.
**Recommended fix:** add a real `estimate_versions`-style snapshot mechanism (even a simple append-only history table keyed by estimate + timestamp would satisfy "every estimate must be versioned").
**Dependencies:** should be designed alongside the D-04 system-consolidation decision.
**Acceptance test:** a user can view and restore a prior version of any estimate line through the UI, without database access.

### D-06 — No `budgets` table; no estimate-to-budget conversion
**Affected workflow:** estimate-to-execution handoff.
**Affected files:** none — the table doesn't exist.
**Root cause:** never built.
**User impact:** procurement requests, vendor bids, and purchase orders exist as real, working, human-gated steps, but none of them ultimately write to any budget concept — there is nowhere for "approved estimate becomes the project budget" to land.
**Data impact:** no way to track committed-vs-budgeted-vs-actual spend distinctly, violating the product rule that preliminary/estimated/budgeted/committed/invoiced/paid/actual/forecast values must remain distinct.
**Security impact:** none.
**Recommended fix:** design and build a `budgets`/`budget_versions` table, populated from an approved estimate, with subsequent commitments (POs, subcontracts) tracked against it.
**Dependencies:** should follow D-04/D-05 (versioning + system consolidation) so the budget snapshot has a stable source to convert from.
**Acceptance test:** approving an estimate creates a budget record; a subsequently issued PO visibly reduces remaining budget on that record.

### D-07 — Markup calculated and labeled as "Profit" without margin distinction
**Affected workflow:** estimating/proposal generation.
**Affected files:** `portal/components/estimate/EstimateMatrix.tsx` (totals calc + SOV/proposal export).
**Root cause:** `finalBid = withOverhead * (1 + profit_pct/100)` computes cost-plus markup; the UI slider is labeled simply "Profit" with no indication of which convention (margin vs. markup) is in effect.
**User impact:** an estimator entering a percentage intending margin-on-price gets a different (lower) dollar profit than intended, silently.
**Data impact:** proposal/SOV totals are systematically understated relative to margin-based intent.
**Security impact:** none.
**Recommended fix:** either clearly label the field as markup (cost-plus) or add an explicit margin-mode toggle with the correct formula (`price = cost / (1 - margin%)`).
**Dependencies:** none.
**Acceptance test:** given a fixed cost and a stated "15% margin" input, the exported proposal's final price yields exactly 15% margin when profit is divided by the final price, not by cost.

---

## P2

### D-08 — `takeoff_items` is missing document-version, sheet-revision, geometry, scale, assembly, creator, and approval-status
**Affected workflow:** manual + AI takeoff, source traceability.
**Affected files:** `portal/app/api/takeoff/items/route.ts`, `portal/supabase/migrations/` (schema).
**Root cause:** the table was designed for quantity/cost-code capture; several fields the product spec requires on every takeoff item were either never added or are lost when data is mirrored in from richer upstream tables (`manual_takeoffs` has `created_by`; `takeoff_items` does not).
**User impact:** cannot trace a given estimate line back to who created it, which document revision it came from, or see its original geometry/scale from the estimate view.
**Data impact:** source-traceability requirement ("every quantity must link to its source document, sheet, revision, geometry, and extraction method") is only partially met.
**Security impact:** none.
**Recommended fix:** add the missing columns and populate them consistently across every write path (manual canvas, AI vision, deterministic extraction, page-takeoff-worker).
**Dependencies:** none — purely additive schema change.
**Acceptance test:** every `takeoff_items` row created by any of the four write paths has a non-null creator and a real (not repurposed) document reference.

### D-09 — Contacts have no relationship table, no dedup, no merge
**Affected workflow:** contact/company management.
**Affected files:** `portal/app/api/contacts/route.ts`, `[id]/route.ts`.
**Root cause:** the feature was built as a flat CRUD seed, not the relationship-modeled system the spec requires.
**User impact:** identical contacts can be created repeatedly with no warning; a person's role can't vary correctly across multiple projects.
**Data impact:** contact data quality will degrade over time with no correction mechanism (no merge exists).
**Security impact:** none.
**Recommended fix:** add a `project_contacts` relationship table (contact × project × role), and a basic duplicate-check (name+email+phone) before insert, before attempting full merge tooling.
**Dependencies:** none technically, but a real product-scope decision on how much of Domain 2 to build now vs. later.
**Acceptance test:** creating a contact with an existing email surfaces a duplicate warning instead of silently inserting a second row.

### D-10 — Two separate estimate/civil-mirror pricing paths can silently disagree
**Affected workflow:** estimate pricing.
**Affected files:** `portal/lib/estimating/auto-sync.ts` (Node), `portal/supabase/functions/page-takeoff-worker/index.ts` (Deno, duplicated logic per its own comment).
**Root cause:** the Deno Edge Function can't import the Next.js module, so pricing/fingerprint logic is hand-duplicated with a documented "keep these in sync" comment — a maintenance-drift risk, not yet an active bug.
**User impact:** none confirmed today, but any future change to one without the other will cause the two ingestion paths to price/dedupe differently.
**Data impact:** potential future inconsistency.
**Security impact:** none.
**Recommended fix:** extract shared pricing/fingerprint logic into a small package importable by both runtimes, or accept the duplication with an automated test asserting both implementations produce identical output for the same input.
**Dependencies:** none.
**Acceptance test:** the same takeoff item, priced via both the Node and Deno code paths, produces an identical `unit_cost`/`pricing_status`/fingerprint.

### D-11 — Cost-override changes and tenant/estimate creation bypass the audit log
**Affected workflow:** audit/compliance.
**Affected files:** `portal/app/api/cost-catalog/overrides/route.ts`, `portal/lib/project-controls/server.ts` (`getOrCreateTenant`), `portal/app/api/estimate/route.ts` (POST).
**Root cause:** the audit helper (`lib/audit.ts`) was wired into 8 files but not these three sensitive-action call sites.
**User impact:** none directly.
**Data impact:** these three action classes have no audit trail despite being financially/structurally sensitive, violating "sensitive actions require audit history."
**Security impact:** minor — reduces forensic ability after an incident.
**Recommended fix:** add `auditInsert` calls to all three.
**Dependencies:** none.
**Acceptance test:** creating a tenant, creating an estimate, or changing a cost override each produce a row in `audit_logs`.

### D-12 — Whole-document ingest path can silently hang forever on Vercel timeout
**Affected workflow:** document processing (single-shot path).
**Affected files:** `portal/app/api/documents/[id]/ingest/route.ts` (`maxDuration=300`, no retry, no partial-progress checkpoint).
**Root cause:** a large document's sequential embedding loop has no internal time budget; if Vercel kills the function at 300s, the document is left in `"processing"` with no error state ever written (the catch block never runs because the process was killed externally).
**User impact:** a user sees a document stuck "processing" indefinitely with no error message and no way to retry short of re-uploading.
**Data impact:** partial/no data for that document.
**Security impact:** none.
**Recommended fix:** add a watchdog/timeout-aware checkpoint, or move large documents to the already-existing async page-split pipeline exclusively.
**Dependencies:** none.
**Acceptance test:** a document large enough to approach the 300s ceiling either completes via checkpointed progress or is marked `status="error"` — never stuck indefinitely.

### D-13 — Page-level document-processing failures are invisible at the document level
**Affected workflow:** async document processing (page-split pipeline).
**Affected files:** `portal/supabase/functions/page-split-worker/index.ts` (fan-out via `Promise.allSettled`, results never inspected).
**Root cause:** individual page failures in `page-processor`/`page-takeoff-worker` only set per-page status columns; nothing aggregates or surfaces them at the parent `documents` record.
**User impact:** a 200-page plan set can have 40 silently-failed pages with no visible indication unless the user proactively polls and cross-references page statuses.
**Data impact:** missing takeoff/OCR data for failed pages, discoverable only by manual inspection.
**Security impact:** none.
**Recommended fix:** aggregate page statuses into a `documents`-level summary field (e.g., `pages_ok`/`pages_error` counts) and surface it in the UI proactively rather than requiring the user to poll.
**Dependencies:** none.
**Acceptance test:** uploading a plan set with an intentionally-broken page shows a visible warning on the document's own status, not just in a per-page detail view.

---

## P3

### D-14 — `.env.example` is drastically out of date
**Affected workflow:** onboarding/deployment configuration.
**Affected files:** `.env.example` (repo root).
**Root cause:** written for an earlier, simpler prototype; never updated as the app grew to ~40 real environment variables.
**User impact:** a new developer/deployment has no accurate reference for required configuration.
**Data impact:** none directly, but misconfiguration risk (e.g., `PYTHON_API_URL` silently defaulting to localhost in production).
**Security impact:** none (no secrets involved, just missing documentation).
**Recommended fix:** regenerate `.env.example` from the full variable list in `ENVIRONMENT_VARIABLE_MAP.md`.
**Dependencies:** none.
**Acceptance test:** every variable referenced in application code has a corresponding (blank/placeholder) entry in `.env.example`.

### D-15 — Zero CI gate between push and production deploy
**Affected workflow:** all.
**Affected files:** no `.github/workflows/`, no `vercel.json`, no `test` script in `package.json`.
**Root cause:** never set up.
**User impact:** none directly.
**Data impact:** none directly, but untested/broken logic can reach production with only a TypeScript-compile check as a gate.
**Security impact:** minor — no automated secret-scanning or dependency-vulnerability gate either.
**Recommended fix:** add a minimal CI workflow running `tsc --noEmit`, `eslint`, and the existing 7 unit tests on every PR/push before Vercel deploys.
**Dependencies:** none.
**Acceptance test:** a PR with a failing test or lint error is blocked from merging/deploying.

### D-16 — No error-tracking/observability service; console-log-only
**Affected workflow:** all, especially background Edge Functions.
**Affected files:** no Sentry/APM dependency anywhere; 20 `console.error` call sites, no structured logger.
**Root cause:** never set up.
**User impact:** none directly.
**Data impact:** none directly.
**Security impact:** none directly, but incident response is slower without alerting.
**Recommended fix:** add a lightweight error-tracking integration (even free-tier Sentry) at minimum for the 4 Edge Functions, which have no other failure-visibility mechanism today besides manually reading function logs.
**Dependencies:** none.
**Acceptance test:** an intentionally-failing Edge Function invocation produces a visible alert/event outside of manually-read raw logs.

### D-17 — Inconsistent RLS strategy stacked redundantly on some tables
**Affected workflow:** database/performance hygiene.
**Affected files:** `documents`, `contacts` (both show `multiple_permissive_policies` in the live Supabase advisor).
**Root cause:** two different RLS-policy authoring patterns (`current_tenant_id()` vs. a `clerk_org_id` subquery) were applied to the same tables at different times, neither removed.
**User impact:** none functionally (both patterns resolve to the same tenant boundary), but adds policy-evaluation overhead and confusion for future schema authors.
**Data impact:** none.
**Security impact:** none (redundant, not conflicting).
**Recommended fix:** consolidate to one RLS pattern per table.
**Dependencies:** should be done as part of the broader D-01 RLS review, not in isolation.
**Acceptance test:** `pg_policies` shows exactly one coherent policy set per table.

### D-18 — Dead/orphaned schema: `roles`, `company_users`, `cost_assemblies`, `assembly_components`, `project_rfis`, `project_change_orders`
**Affected workflow:** none currently (dead code).
**Affected files:** listed tables; confirmed zero application-code references to any of them.
**Root cause:** scaffolded for features that were either superseded (`project_rfis`/`project_change_orders` by `rfi_items`/`change_order_items`) or never wired in (`roles`/`company_users`/`cost_assemblies`/`assembly_components`).
**User impact:** none.
**Data impact:** none (all empty).
**Security impact:** minor — `cost_assemblies`/`assembly_components`/`cost_codes`/etc. are unnecessarily GraphQL-exposed per the security advisor, dead attack surface for no functional benefit.
**Recommended fix:** per the "existing features must not be removed until replacements are proven" rule, do not delete outright — but revoke unnecessary GraphQL/API exposure on the confirmed-dead ones, and flag for a future cleanup pass once their intended replacements (or lack thereof) are confirmed by product decision.
**Dependencies:** none.
**Acceptance test:** GraphQL introspection no longer exposes `cost_assemblies`/`assembly_components` to authenticated users who have no code path that ever reads them.

### D-19 — Loose Node.js prototype and stray files not yet cleaned up
**Affected workflow:** none (dead code / repo hygiene).
**Affected files:** `public/index.html`, `public/takeoff-grid.js`, `lib/agents/` (repo-root, empty), `portal/.env.local.bak`, `portal/server.err.log`, `portal/server.out.log`.
**Root cause:** leftover from an earlier prototype/layout, never removed.
**User impact:** none — confirmed unreferenced by any deployed config.
**Data impact:** none.
**Security impact:** none directly noted, though stray log files in the working tree are worth confirming don't contain sensitive request data before any future public repo exposure.
**Recommended fix:** remove once confirmed genuinely dead (already substantially confirmed this pass).
**Dependencies:** none.
**Acceptance test:** repo builds and deploys identically after removal.

---

## P4

### D-20 — `lucide-react` pinned to an unusual `^1.21.0` range
**Affected workflow:** none currently functional.
**Affected files:** `portal/package.json`.
**Root cause:** unclear — lucide-react's mainline releases are typically in the 0.3xx.x line; this pin should be double-checked against the registry.
**User impact:** none observed.
**Data impact:** none.
**Security impact:** none directly, worth confirming it isn't a fork/typosquat.
**Recommended fix:** verify the package resolves to the intended upstream library.
**Dependencies:** none.
**Acceptance test:** confirmed to be the genuine `lucide-react` package at the intended version.

### D-21 — Python dependencies pinned with exact versions, no automated update mechanism
**Affected workflow:** none currently functional.
**Affected files:** `requirements.txt`.
**Root cause:** deliberate reproducibility choice, but combined with no Dependabot/CI, means security patches require manual discipline to pick up.
**User impact:** none currently.
**Data impact:** none.
**Security impact:** low — no known CVEs identified in this pass, but no automated detection exists either.
**Recommended fix:** add a dependency-update bot (Dependabot or similar) even without loosening the exact-pin policy.
**Dependencies:** none.
**Acceptance test:** a security advisory affecting a pinned dependency is automatically surfaced within a reasonable window.

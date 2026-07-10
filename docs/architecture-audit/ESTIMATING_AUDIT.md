# Estimating Audit

## The single biggest structural finding: two parallel, disconnected estimate systems

### System 1 — `estimate_items` (legacy, but currently the primary auto-sync target)

`app/api/estimate/route.ts` (GET/POST), `app/api/estimate/[id]/route.ts` (PUT/DELETE) — flat CRUD. **One blended `unit_cost` field only** — no labor/material/equipment/trucking/subcontractor split, no distinct contingency/overhead/profit fields. Not versioned: PUT does a `SELECT *` purely to hand the "before" state to the audit logger (a fire-and-forget JSON blob in `audit_logs`), not a recoverable version/snapshot table. Recovering a prior price requires manually querying `audit_logs.old_values` — not exposed anywhere in the UI. **Estimate creation itself is not audited** (only the update/delete path calls the audit helper).

### System 2 — `project_estimates` + `project_financial_settings` (matrix, richer, more current)

`app/api/estimate/matrix/route.ts` — explicit code comment confirms the split is *intentional*: *"Pricing Matrix — dedicated CRUD... Separate from `/api/estimate` (legacy `estimate_items` table) so both live side by side."* Row shape: `labor_unit, material_unit, equipment_unit, subcontractor_unit, trucking_unit, disposal_unit` — the full cost-split the spec wants, **but only here**. Settings (`overhead_pct, profit_pct, contingency_pct`) are one flat set per project, not versioned, not per-line-item. No versioning here either — POST is a plain upsert.

**Consequence:** takeoff data has to be synced twice into two different tables (`syncTakeoffToEstimate` targets only `estimate_items`; the matrix has its own separate `/api/estimate/matrix/seed` endpoint) to appear in both systems. Data entered in one is invisible in the other. The cost resolver (`lib/cost/resolver.ts`) *does* return a labor/material/equipment split when sourced from `cost_overrides`/`cost_prices` — but `auto-sync.ts` discards that split when merging into `estimate_items`, flattening everything to one number. Only the separately-populated matrix table retains the real split.

## Formulas — confirmed markup-labeled-as-margin bug

Direct quote, `EstimateMatrix.tsx:143-150`:
```ts
const direct = rows.reduce((s, r) => s + rowDirect(r), 0);
const contingency = direct * (settings.contingency_pct / 100);
const subtotal = direct + contingency;
const withOverhead = subtotal * (1 + settings.overhead_pct / 100);
const finalBid = withOverhead * (1 + settings.profit_pct / 100);
```

**The "Profit %" slider computes cost-plus markup (profit ÷ cost), not price-based margin (profit ÷ price), with no distinction surfaced to the user.** If an estimator enters `profit_pct: 15` intending a 15% margin on the final sell price, the actual formula produces `withOverhead * 0.15` — less dollar profit than a true margin calculation would require (`finalBid = withOverhead / (1 - 0.15)`). The UI labels this simply "Profit" with no markup/margin distinction. This is a classic, consequential estimating bug: whichever the estimator *intends*, the math unambiguously computes markup-on-cost.

## Proposal / SOV generation — real, working, but scoped to only one of the two systems

`EstimateMatrix.tsx`'s `exportProposal()` is a genuine, functioning client-side XLSX (SheetJS) export — two sheets: "Proposal" (grouped by cost code with contingency/overhead/profit/final-bid rows) and literally titled "Schedule of Values" (per-line labor/material/equipment/sub/trucking/disposal/direct/overhead/profit/SOV-value columns). This only operates on `project_estimates` (matrix) data — `estimate_items` has no proposal/SOV generator at all. No PDF generator and no server-side SOV route exist; it's entirely a client-side export triggered from the matrix UI.

## Assemblies — two disconnected implementations

- DB tables `cost_assemblies`/`assembly_components` — confirmed orphaned, zero application code references (see DATABASE_AUDIT.md).
- The actual "Insert Assembly Mix" UI feature calls `calculateAssemblyQuantities` from `lib/math/assemblies.ts` — a pure, **hardcoded** client-side formula file (concrete volume/aggregate/rebar only). This has nothing to do with the DB assembly tables; it's a fixed calculator, not an extensible catalog.

## Buyer-specific pricing — not built

Repo-wide grep for "buyer" returns exactly one hit, a static UI string unrelated to pricing logic. No per-client rate tables or customer-tier pricing exist.

## Estimate approval / estimate-to-budget conversion — not built

No estimate "approval" state machine exists distinct from generic field mutation — `pricing_status` string changes are the closest analog, per the code's own comment ("pricing_status changes are effectively estimate item approval/rejection"). **No `budgets` table exists anywhere** — confirmed via a repo-wide file/table sweep returning zero hits, and no route reads estimate data and writes anything budget-shaped. Estimate-to-budget conversion is entirely unbuilt, confirming a prior-session finding.

**Verified pipeline hops, end to end:** `takeoff_items` → **auto** → `estimate_items` → **manual** "package quote" action → `marketplace_requests` → external/manual vendor response → `vendor_bids` → **manual** "approve & generate PO" action → `purchase_orders` → **nowhere**, since no budget table exists to receive it. No "approved" status transition exists on estimates at all.

## Contact and Company Workflow

- `contacts` — flat single table (`name, company [free text], role, email, phone, notes, project_id`). **No separate project-contact relationship table** — role and project are single fields directly on the contact row, so a person cannot have a different role on a different project (a direct spec violation of "project-specific roles must exist on relationship records").
- **Duplicate detection confirmed absent** — POST always blindly inserts; identical name/email/phone can be created twice with zero warning. Confirmed by code inspection (only `name` non-empty and `project_id` UUID validity are checked pre-insert).
- **Merge functionality confirmed absent** — repo-wide grep for "merge" near contacts/companies returns zero hits.
- `/api/contacts/parse` — real, working AI extraction from pasted text, correctly does not auto-save (candidates only) — but confirmed standalone, not wired into any document/plan-upload pipeline. Zero other callers found repo-wide besides the manual paste-and-review UI.
- `companies` table — confirmed strictly 1:1-per-tenant (the caller's own firm/billing profile, `subscription_status` etc., DB-enforced via a `UNIQUE(tenant_id)` constraint). **Not** a CRM table of external companies (GCs, subs, owners) — that concept doesn't exist as a structured entity; the only analog is the unstructured free-text `company` string on individual contact rows, with no dedup and no roll-up.
- No source-provenance field on contacts (no "extracted from document X, page Y" equivalent to `estimate_items`' `source_takeoff_id`/`source_fingerprint`), no dedicated project-directory view beyond a `project_id` filter, no contact search endpoint, no communication-history table.

## Summary of the biggest structural risks

1. Two parallel, disconnected estimate pipelines with different cost-field granularity and no shared sync.
2. No real versioning/snapshot on estimate data anywhere — only a fire-and-forget audit-log blob.
3. Markup vs. margin conflation in the profit calculation, unsurfaced to the user.
4. No `budgets` table and no estimate-to-budget conversion.
5. `companies` is strictly the tenant's own firm record — no structured external-company entity exists.
6. No dedup/merge anywhere in contacts or companies.
7. AI contact parsing is a standalone tool, disconnected from the actual document pipeline.

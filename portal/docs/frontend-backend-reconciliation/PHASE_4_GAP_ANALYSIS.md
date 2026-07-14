# Phase 4 — evidence-based workspace audit

Fresh audit of Procurement, Civil Intelligence, AI Workforce, Marketing, and
Reports against actual routes/APIs/tables/components (not the Phase 1
capability matrix alone), before deciding what to build vs. label
"Coming Soon."

## Built this phase (real backend confirmed, now exposed globally)

| Workspace | Evidence found | What shipped |
|---|---|---|
| **Procurement** | `marketplace_requests`/`vendor_bids`/`purchase_orders` tables, `/api/procurement/requests` + `/api/procurement/bids`, `ProcurementBoard.tsx` (already wired at project level in item 1) | `/dashboard/procurement` — cross-project RFQ/bid/PO roll-up. Made `project_id` optional on the existing route rather than duplicating it. **Also fixed a real tenant-isolation gap found while reading the route**: the purchase-orders query had no `tenant_id` filter at all, only `project_id` — now scoped by both. |
| **Civil Intelligence** | `earthwork_volumes` table + `/api/earthwork/volumes` (real mass-haul math via `lib/math/earthwork.ts`, not a stub) | `/dashboard/civil-intelligence` — cross-project cut/fill/net-balance roll-up. Explicitly does **not** claim to cover utility pipe runs, construction entrances, stockpiles, or the material ledger globally yet — see gap table below. |
| **Financials** | `invoices` + `lien_waivers` tables, `/api/invoices` (already financial-read-gated from item 4) + `/api/lien-waivers` (was **not** gated — closed now) | `/dashboard/financials` — cross-project AR/AP + lien waiver roll-up, redacts `amount` for restricted roles on both endpoints. |
| **AI Workforce** | `ai_agent_audit_trails` table, `/api/agents/*`, `AgentApprovalFeed.tsx` — already a complete, real, tenant-wide human-approval workflow (approve/reject/modify hit real endpoints) | No changes needed — already fully wired (this was done in Phase 2, confirmed again here). |
| **Marketing** | `marketing_campaigns`/`marketing_leads` tables, `/api/marketing/*`, `MarketingCommandCenter.tsx` — already tenant-wide (no `project_id` required) | No changes needed — already fully wired (Phase 2). |

All five routes above verified for tenant isolation (every query scoped by
`tenant_id`, not just `project_id`) and role visibility (financial-read gate
applies where amounts are shown) before shipping.

## Still "Coming Soon" — exact gap, not a placeholder

### Preconstruction
- **Missing tables**: no `bid_pipeline`/`preconstruction_opportunities`
  concept exists anywhere in the schema.
- **Missing APIs**: none.
- **Missing workflow**: a company-wide view of bids being pursued
  pre-award (the master prompt's "aggregates bid pipeline across projects")
  has no source table to aggregate — `projects` only models awarded/active
  work, not a pursuit/opportunity pipeline.
- **To build**: a new `bid_opportunities` table (stage, estimated value,
  win probability, target bid date, linked estimate draft), CRUD API, and a
  workspace. Genuinely new scope, not a recomposition of existing data.

### Project Management (global roll-up)
- **Missing**: not missing data — RFIs, submittals, change orders,
  schedule tasks, daily/weekly logs, punch list, and staff all have real
  per-project tables and APIs (`project_rfis`/`submittal_items`/
  `change_order_items`/`schedule_tasks`/`daily_logs`/`weekly_logs`/
  `punch_list_items`/`staff_members`). What's missing is a single
  cross-project aggregation route and page tying all seven together into
  one "open items across every project" view.
- **To build**: one new `/api/project-management/overview` route that
  fans out to each of the seven tables (tenant-scoped, `project_id`
  optional like the four built this phase) and a page presenting them as
  one workspace. This is the most mechanically straightforward of the
  four remaining gaps — flagged as the first candidate for a future
  milestone, not because it's technically hard but because it's a wider
  aggregation (7 tables vs. 1-2) than fit in this phase's effort budget.

### Reports
- **Missing tables**: no `report_templates`, `report_runs`, or
  `saved_reports` table exists.
- **Missing APIs**: only `/api/status-report` (POST, per-project,
  synchronous AI-generated text, no persistence — confirmed by reading
  the route: it calls `generateText()` and returns the string directly,
  never writes a row anywhere).
- **Missing workflow**: no report library, no scheduling, no export/
  history, no cross-project reporting of any kind.
- **To build**: a `report_runs` table (report type, params, generated_at,
  output — persisted, not regenerated on every view), a way to select a
  report type per data domain (financial, schedule, procurement, etc.),
  and a workspace listing past runs + a "generate new" action. Substantial
  new scope, correctly excluded from "build what's real" this phase since
  nothing here currently exists to expose.

### Civil Intelligence — sub-scope explicitly not yet global
Utility pipe runs (`civil_pipe_runs`), construction entrances
(`civil_construction_entrances`), stockpiles (`civil_stockpiles`), and the
material ledger (`civil_material_ledger`) each have real per-project tables
and APIs (`/api/earthwork/pipe-runs`, `/entrances`, `/stockpiles`,
`/ledger`) but were **not** rolled into the global workspace this phase —
only cut/fill volumes were, since that's the one clear site-wide KPI
(cut/fill/net-balance in cubic yards). The other four are itemized,
per-feature lists (individual pipe runs, individual stockpiles) that don't
reduce to a single meaningful roll-up number the same way volumes do;
surfacing them globally would need a different UI shape (e.g. a filterable
table per sub-resource) than this phase's effort budget covered. Documented
here as a real, actionable follow-up rather than silently dropped.

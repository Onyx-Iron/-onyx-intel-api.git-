# Current Estimate Systems (pre-consolidation)

## System A: `estimate_items`
- Columns (pre-migration): `id, tenant_id, project_id, trade, csi_code, description, item_type, quantity, uom, unit_cost, notes, sort_order, created_at, updated_at, source_takeoff_id (FK -> takeoff_items, ON DELETE SET NULL), source_fingerprint, quantity_basis, drawing_ref, location_tag, pricing_status`.
- One flat `unit_cost` — no labor/material/equipment/etc. breakdown.
- Has source traceability (`source_takeoff_id`/`source_fingerprint`) and a review-status gate: `syncTakeoffToEstimate`/`buildEstimateImportRows` (`lib/estimating/takeoff-import.ts:159`) only import `takeoff_items` rows with `review_status = "approved"`.
- No versioning, no approval concept, no header table — just flat rows per project.
- Read/written by `app/api/estimate/route.ts`, `app/api/estimate/[id]/route.ts`, `app/api/estimate/import-takeoff/route.ts`, `lib/estimating/auto-sync.ts`, `lib/estimating/civil-mirror.ts`.

## System B: `project_estimates` + `project_financial_settings`
- `project_estimates`: `id, tenant_id, project_id, takeoff_id, source, cost_code, description, quantity, unit, labor_unit, material_unit, equipment_unit, subcontractor_unit, trucking_unit, disposal_unit, notes, sort_order, created_at, updated_at` — per-unit RATES, not totals.
- `project_financial_settings`: one row per project (`overhead_pct, profit_pct, contingency_pct`) — a single global setting, not versioned.
- Has the cost-category breakdown System A lacks, but no `source_takeoff_id` FK (only an unconstrained `takeoff_id` uuid), no review-status gate, no versioning, no audit trail.
- Read/written exclusively by `app/api/estimate/matrix/route.ts` (its own doc-comment confirms it was deliberately split off as a separate "Pricing Matrix" system) and rendered by `components/estimate/EstimateMatrix.tsx`.

## Proposal / SOV generation (pre-consolidation)
- **No server-side proposal or SOV generation existed at all.** `EstimateMatrix.tsx`'s `exportProposal()` (lines 307-365) computed both a "Proposal" sheet and a "Schedule of Values" sheet entirely client-side, from `project_estimates` rows + `project_financial_settings`, and wrote directly to an XLSX file — never persisted, never versioned, no server-side total to check against.

## Cost resolution
- `lib/cost/resolver.ts`'s `resolveCost`/`resolveCostsBatch` already discloses source (`tenant_override | actuals_avg | regional_price | national_price | none`) and, when available, a `labor_cost`/`material_cost`/`equipment_cost` breakdown per cost code — this existed already but neither estimating system consumed the breakdown (System A collapsed it to one `unit_cost`; System B never called the resolver at all).

## Least-destructive-migration observation
System A (`estimate_items`) already has the two properties hardest to retrofit — source traceability and the review-status approval gate — both already tested and load-bearing for Milestone 1. System B has only a cost-category breakdown, which is an additive column migration. Making System B authoritative instead would require rebuilding source-linkage and the review gate from scratch: strictly more destructive.

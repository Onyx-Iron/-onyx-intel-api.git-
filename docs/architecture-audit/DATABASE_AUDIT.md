# Database Audit

Live project `vvnigrbdsipriufhrwbs`. 76 tables in `public` schema, RLS enabled on all 76. Only 9 tables currently hold data (dev/staging volumes): `cost_codes` (52), `cost_catalog` (26), `project_events` (23), `takeoff_items` (22), `projects` (4), `documents` (4), `tenants` (1), `google_connections` (1), `ai_rate_limit_hits` (1). Everything else — including `companies`, `contacts`, `estimate_items`, `audit_logs`, `cost_assemblies`, all `civil_*` tables — is empty.

## Tenants / companies / contacts / roles / company_users

| Table | FK-covered | RLS | Code usage |
|---|---|---|---|
| `tenants` | — | `self_select` policy (`id = current_tenant_id()`), forced | `getOrCreateTenant()` in `lib/project-controls/server.ts:37-41` — **no audit call on creation** |
| `companies` | `UNIQUE(tenant_id)` DB constraint | 4-policy tenant_isolation set, forced | Confirmed 1:1-per-tenant by `ensureCompany()` (`app/api/companies/route.ts:20-27`, `maybeSingle()` lookup). Creation/update **is** audited (`auditInsert`/`auditUpdate`). |
| `contacts` | `contacts_tenant_id_fkey` (CASCADE), `contacts_project_id_fkey` (SET NULL) | `tenant_isolation` + `tenant_isolation_contacts`, both via `clerk_org_id` subquery — inconsistent pattern vs. most other tables (which use `current_tenant_id()`) | Read/written in `app/api/contacts/route.ts`, `[id]/route.ts`, `app/api/search/route.ts`. No merge endpoint exists anywhere. |
| `company_users` | FK to `companies`(CASCADE) and `roles`(SET NULL) | Full 4-policy set, forced | **Zero application code references** — dead table |
| `roles` | `tenant_id` column present but **no FK constraint** to `tenants` — relies solely on RLS, unlike every other tenant-scoped table | 4-policy set via `current_tenant_id()` | **Zero application code references** — dead table |

`roles`/`company_users` are fully scaffolded (tables + RLS + FKs) but entirely unused. A separate, real, narrow RBAC layer exists via `project_profiles.role` + `lib/project-controls/permissions.ts` — see AUTHORIZATION_AUDIT.md.

## Documents / pages / chunks / sheets / revisions

| Table | FK | RLS | Notes |
|---|---|---|---|
| `documents` | `documents_tenant_id_fkey` (CASCADE), `documents_project_id_fkey` (SET NULL) | 4 tenant policies **plus** a redundant `tenant_isolation_documents` ALL policy via clerk_org_id — two RLS strategies stacked on one table | 4 live rows |
| `document_pages` | FK to `documents` (CASCADE) | forced | — |
| `document_chunks` | FK to `document_pages`/`documents` (CASCADE) | forced | Written only by `page-processor` Edge Function; no direct app-code reads via `.from()` (reads happen via vector-match RPC) |
| `sheet_calibrations` | FK to `document_pages` (CASCADE) | forced | "Sheet" is modeled as `document_pages` + calibration data only — no distinct sheet entity |

**No revision-tracking table exists at all.** Confirmed via exhaustive `information_schema.tables` sweep for `%version%`/`%revision%` — zero hits. The "revision" concept that exists (`lib/documents/revisions.ts`) is a filename-parsed, non-authoritative grouping (`family_key`, `revision_rank` derived from regex on the uploaded filename), stored in `documents.meta` jsonb, not a dedicated column/table. Every re-upload creates a brand-new, unrelated `documents` row with no FK/supersession link — a filename that doesn't match the expected pattern silently becomes an unrelated, ungrouped document.

## Takeoff & civil tables

- `takeoff_items` (22 rows) — FK-covered (`document_id` SET NULL, `project_id`/`tenant_id` CASCADE). Columns: `id, tenant_id, project_id, document_id, page, type, label, quantity, unit, rate, csi_code, division, points, px_per_foot, geo_calib, created_at, updated_at, meta, geom_local, geom_sp, geom_wgs84`. **No first-class `created_by`/`approval_status` column** — only a generic `meta` jsonb, and confirmed the primary write route (`app/api/takeoff/items/route.ts`) doesn't even populate creator info into `meta`. Creator tracking (`created_by`) exists on the adjacent civil canvas tables (`manual_takeoffs`, `civil_pipe_runs`, etc.) but is lost the moment those rows are mirrored into `takeoff_items`.
- `manual_takeoffs`, `civil_pipe_runs`, `civil_stockpiles`, `civil_construction_entrances`, `civil_utility_takeoffs` — all FK'd to `projects` (CASCADE), RLS forced. **None carry a direct `tenant_id` FK to `tenants`** (same gap pattern as `roles`) — tenant scoping relies on RLS alone for this whole table family.

## estimate_items / project_estimates — no versioning

- `estimate_items` — FK-covered (`tenant_id`/`project_id` CASCADE, `source_takeoff_id` → `takeoff_items` SET NULL). Full column list: `id, tenant_id, project_id, trade, csi_code, description, item_type, quantity, uom, unit_cost, notes, sort_order, created_at, updated_at, source_takeoff_id, source_fingerprint, quantity_basis, drawing_ref, location_tag, pricing_status`. **No `version`/`snapshot` column or table exists anywhere.** `pricing_status` is the only state-tracking field. **Estimate creation is not audited** — only the update/delete path in `app/api/estimate/[id]/route.ts` calls `auditInsert`/`auditUpdate`/`auditDelete`; the POST creation route does not.
- `project_estimates` — a separate table (matrix system), FK'd to `projects` (CASCADE), standard 4-policy RLS. See ESTIMATING_AUDIT.md for why this and `estimate_items` are two disconnected systems.

## Cost tables

| Table | Rows | RLS | FK | Notes |
|---|---|---|---|---|
| `cost_codes` | 52 | `catalog_read` (any authenticated user, no tenant scope — intentional, shared catalog) | referenced by cost_prices/overrides/actuals | Seeded this session |
| `cost_catalog` (legacy) | 26 | tenant_isolation, forced | `cost_catalog_tenant_id_fkey` (CASCADE) | Still has live data — legacy table not yet retired, still the primary price source for the main estimate auto-sync path (see ESTIMATING_AUDIT.md) |
| `cost_prices` | 0 | `catalog_read` (SELECT only — **no insert/update/delete policy exists**, meaning writes are only possible via the service-role client, which bypasses RLS anyway) | FK to `cost_codes` (CASCADE) | — |
| `cost_overrides` | 0 | Full 4-policy set, forced | FK to `cost_codes` (CASCADE) | Written via `app/api/cost-catalog/overrides/route.ts` — **not audited** (no `auditInsert`/`auditUpdate` call in that file) |
| `cost_actuals` | 0 | Full 4-policy set, forced | FK to `cost_codes` (SET NULL) | — |
| `cost_assemblies` / `assembly_components` | 0 / 0 | `catalog_read` only | `assembly_components → cost_assemblies` (CASCADE) | **Confirmed orphaned** — zero application code references anywhere. Also flagged by the security advisor as unnecessarily GraphQL-exposed to every authenticated user. |

## audit_logs

Schema: `id, tenant_id, user_id, action_type, table_name, record_id, old_values, new_values, created_at`. Central helper `lib/audit.ts` (`logAudit`/`auditInsert`/`auditUpdate`/`auditDelete`), fire-and-forget/non-blocking.

**Confirmed writers (8 files):** `app/api/companies/route.ts`, `app/api/rfis/route.ts`, `app/api/lien-waivers/route.ts`, `app/api/invoices/route.ts`, `app/api/estimate/[id]/route.ts`, `app/api/change-orders/route.ts`, `app/api/procurement/bids/[id]/approve/route.ts`, `app/api/projects/[id]/route.ts`.

**Confirmed gaps** (sensitive actions with NO audit record):
- Tenant creation (`getOrCreateTenant`)
- Estimate creation (`app/api/estimate/route.ts` POST)
- Cost override changes (`app/api/cost-catalog/overrides/route.ts`)
- Contact merge — N/A, feature doesn't exist
- `company_users`/`roles` mutations — N/A, nothing writes these tables

## AI-suggestion review/approval state

**No first-class approval/review/processing_job table exists** (confirmed via exhaustive `information_schema` sweep for `%approval%`/`%review%`/`%processing_job%` — zero matches). Review state is tracked as plain columns on existing rows: `estimate_items.pricing_status` (text, default `"manual"`) and a `confidence` field on vision-extraction meta. This is a status-column pattern, not a first-class reviewable record with its own audit trail. See TAKEOFF_AUDIT.md for the compliance assessment against "no AI quantity may automatically become approved."

## Supabase Advisors (live, current)

**Security advisor — 8 findings, all WARN, zero ERROR:**
- 6× `pg_graphql_authenticated_table_exposed`: `assembly_components`, `commodity_trend_series`, `cost_assemblies`, `cost_codes`, `cost_indices`, `cost_prices`, `tenants` all discoverable via GraphQL introspection to any signed-in user. The `cost_assemblies`/`assembly_components` exposure is dead-surface (nothing reads them); `tenants` being introspectable (even though row-level `self_select` RLS still applies) is a minor information-disclosure concern.
- 1× `authenticated_security_definer_function_executable`: `current_tenant_id()` is directly RPC-callable by any authenticated user — likely intentional (this is how RLS resolves tenant scope) but flagged since it's SECURITY DEFINER.
- 1× `auth_leaked_password_protection`: HaveIBeenPwned check disabled at the Auth level — a quick Supabase dashboard setting, not a schema issue.

**Broader lint sweep (211 total findings, all WARN/INFO, zero ERROR):** 105× `unused_index`, 72× `multiple_permissive_policies`, 28× `auth_rls_initplan`, 5× `unindexed_foreign_keys`, 1× `auth_db_connections_absolute`. Notable table hits: `contacts` and `documents` both show `multiple_permissive_policies` (consistent with the redundant-RLS-strategy finding above), `cost_overrides` shows `unindexed_foreign_keys`. None of these are correctness bugs on their own — they're performance/hygiene findings, but the `multiple_permissive_policies` hits corroborate the "two RLS strategies stacked" observation on `documents`/`contacts` above.

## Migrations: applied vs. tracked vs. loose files

- **53 migrations tracked live** by Supabase (`YYYYMMDDHHMMSS` naming) vs. **41 `.sql` files** in `portal/supabase/migrations/` (`YYYYMMDD` naming, no time component). The two schemes don't diff cleanly by filename, but the count gap means **at minimum ~12 applied schema changes have no corresponding file in the repository.**
- **9 loose SQL files** (`schema.sql`, `portal/supabase-schema.sql`, `portal/supabase-migration-v2.sql` through `v9.sql`) sit outside the tracked migrations directory — this is the exact pattern that caused the `v7` incident (columns defined in a file that was never actually applied, discovered only when a production error surfaced). The other 8 files carry the identical unreconciled risk today.

## The single most important structural finding (see AUTHORIZATION_AUDIT.md for full detail)

**RLS is effectively decorative.** All 76 tables have real, mostly-correct RLS policies — but 91 of 121 API route files (essentially all of them that touch Supabase) use `createServiceClient()`, which authenticates as Postgres `service_role` and **unconditionally bypasses RLS**. Zero route files use the anon/user-scoped client that would actually be subject to `current_tenant_id()`-based policies. Tenant isolation today depends 100% on every route remembering its own `.eq("tenant_id", ...)` filter in application code, with no independent database-level backstop.

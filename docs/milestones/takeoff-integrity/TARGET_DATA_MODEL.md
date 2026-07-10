# Target Data Model — Takeoff Integrity Milestone

Field-by-field comparison of `takeoff_items` against the required model. Every field is normalized into `takeoff_items` itself (no new related table was needed for ownership/source/measurement/control) **except** the lifecycle audit trail, which is a genuinely separate append-only table (`takeoff_item_history`) since history is inherently one-to-many.

## Ownership

| Required | Status | Notes |
|---|---|---|
| `tenant_id` | ✅ existing | FK to `tenants`, CASCADE |
| `company_id` | **N/A — not applicable to the existing tenancy model** | `companies` is 1:1-per-tenant (the tenant's own firm/billing profile, DB-enforced via `UNIQUE(tenant_id)` — see DATABASE_AUDIT.md). There is no concept of multiple companies per tenant that a takeoff item could belong to; `tenant_id` already is the full ownership boundary. Adding `company_id` would either always equal a value 1:1-derivable from `tenant_id` (a duplicate source of truth) or require inventing a multi-company model that doesn't exist anywhere else in the app. Deferred — would need to be designed as part of a real multi-company-per-tenant feature, not invented here. |
| `project_id` | ✅ existing | FK to `projects`, CASCADE |

## Source

| Required | Status | Notes |
|---|---|---|
| `document_id` | ✅ existing | FK to `documents`, SET NULL |
| `document_version_id` | **Deferred — no `document_versions` table exists** | Confirmed in DOCUMENT_PIPELINE_AUDIT.md: revision tracking is a filename-parsed text label (`documents.meta.family_key`/`revision_rank`), not a real version table. Building full document-versioning infrastructure is a separate Document Pipeline milestone. This milestone adds `document_revision` (text) as a best-effort snapshot of that label at takeoff-creation time — not a surrogate FK, explicitly commented as such in the migration. |
| `sheet_id` | ✅ **new** | FK to `document_pages(id)`, SET NULL. `document_pages` is the existing "sheet" entity (confirmed in DATABASE_AUDIT.md: "sheet" has no distinct table, it's modeled as `document_pages` + `sheet_calibrations`). |
| `sheet_revision_id` | **Deferred — no `sheet_revisions` table exists**, same reasoning as `document_version_id`. `sheet_revision` (text) added as the equivalent best-effort snapshot. |
| `page_number` | ✅ existing | The `page` column already serves this purpose. |

## Measurement

| Required | Status | Notes |
|---|---|---|
| `measurement_type` | ✅ existing, not duplicated | The `type` column already holds this (`length\|area\|count\|volume\|general\|takeoff_import`). Documented via a column comment rather than adding a same-meaning column under a new name. |
| `geometry` | ✅ **new** | jsonb. Populated for manually-drawn shapes; explicitly `null` (with `meta.geometry_unavailable: true`) for AI-vision items, which have no drawn geometry — never fabricated. |
| `coordinate_system` | ✅ **new** | text, default `'canvas_px'` — documents that `geometry`/`geom_local` are in canvas pixel space unless otherwise noted. Satisfies the model's "or documented drawing-space system" allowance rather than requiring a full CRS implementation. |
| `scale` | ✅ existing, not duplicated | `px_per_foot` already is this value (pixels per real-world foot) for canvas-drawn geometry. Documented via column comment. |
| `scale_unit` | ✅ **new** | text, default `'ft'`. |
| `quantity` | ✅ existing | — |
| `quantity_unit` | ✅ existing, not duplicated | The `unit` column already holds this. |

## Estimating

| Required | Status | Notes |
|---|---|---|
| `cost_code_id` | **Deferred — natural key used instead of a surrogate FK** | `csi_code` (text) is already a stable reference into `cost_codes.csi_code`, which carries a `UNIQUE` constraint (confirmed in DATABASE_AUDIT.md) — it is already a valid, enforced natural key, just not a surrogate UUID FK. Every write path across the Python engine, all four takeoff_items writers, and the pricing resolver already keys on `csi_code` text; converting to a surrogate `cost_code_id` FK would be a large, cross-cutting rewrite of the cost-resolution pipeline, explicitly out of this milestone's scope ("do not attempt an uncontrolled rewrite"). Documented as a remaining item in REMAINING_RISKS.md. |
| `assembly_id` | **Deferred — depends on an unresolved product decision** | `cost_assemblies`/`assembly_components` are confirmed orphaned/dead tables (DEFECT_REGISTER.md D-18) — no live assembly system exists to reference. This milestone keeps the existing `assembly` (text label) column rather than wiring a FK to a table nothing else uses. Building a real assembly FK is contingent on RECOVERY_ROADMAP.md's decision to either wire up or retire `cost_assemblies`. |
| `estimate_item_id` | **Deliberately NOT added — would be a duplicate source of truth** | `estimate_items.source_takeoff_id` already captures this exact relationship in the other direction. Adding a mirrored `takeoff_items.estimate_item_id` would create two columns that must always agree with each other with no single owner — the "no duplicate sources of truth" rule takes precedence. The relationship is queryable via `estimate_items` today; a view could be added later if a reverse-lookup index is ever a performance need. |

## Control

| Required | Status | Notes |
|---|---|---|
| `source_method` | ✅ **new** | text (`manual`\|`ai_vision`\|`civil_calculator`\|`deterministic`\|`legacy_unknown`). Backfilled from `meta.extraction_method` where present; existing rows with no recorded method are marked `legacy_unknown` rather than guessed. |
| `confidence_score` | ✅ **new** | numeric, nullable. Backfilled from `meta.confidence` where a parseable number existed; otherwise left `NULL` (an honest "not available" state, not fabricated). |
| `review_status` | ✅ **expanded** | The canonical 4-state lifecycle: `suggested` → `reviewed` → `approved` \| `rejected`. This column is also where `approval_status` is consolidated — see the note below. |
| `approval_status` | **Consolidated into `review_status` — not a separate column** | The spec lists both `review_status` and `approval_status`. Implementing them as two independent columns risks exactly the "duplicate source of truth" problem the spec elsewhere warns against (what does it mean for `review_status='approved'` but `approval_status='rejected'`?). `review_status`'s 4-value enum already fully encodes the approval decision (`approved`/`rejected` are terminal states within it), so a separate `approval_status` would either always be redundant or become a second, disagreeing source of truth. Consolidated deliberately; documented here so the decision is explicit rather than a silent omission. |
| `approved_by` | ✅ **new** | text, set only when `review_status` transitions to `approved` (distinct from the more general `reviewed_by`, which is set on any review action). |
| `approved_at` | ✅ **new** | timestamptz, same semantics as `approved_by`. |
| `created_by` | ✅ **new** | text (Clerk user id). Null for AI-sourced rows (no human created them). |
| `updated_by` | ✅ **new** | text, set on every edit through `/api/takeoff/items` and the review endpoint. |
| `created_at` | ✅ existing | — |
| `updated_at` | ✅ existing | — |

## Lifecycle audit trail — `takeoff_item_history` (new table)

Genuinely one-to-many (a takeoff item accumulates many history events over its life), so this is the one place a related table was the correct normalization rather than more columns on `takeoff_items`. Schema: `id, tenant_id, project_id, takeoff_item_id (no FK cascade — survives a hard delete), action (created|updated|deleted|approved|rejected), actor_user_id, before (jsonb), after (jsonb), created_at`. RLS enforced via `tenant_id = current_tenant_id()`.

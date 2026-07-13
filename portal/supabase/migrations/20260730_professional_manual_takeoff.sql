-- Professional Manual Takeoff Engine (milestone: professional-manual-takeoff,
-- Phase 1 "Foundation" scope).
--
-- Consolidation decision: `manual_takeoffs` + `sheet_calibrations` (keyed to
-- the authoritative `document_pages` entity, cost-code-aware) is confirmed
-- as the sole system actually wired into any UI/API code — grepped the
-- entire app/components/lib tree for `manual_measurements` and found ZERO
-- references outside migrations/RLS policies. `manual_measurements` is
-- marked deprecated (not dropped — STEP 33: "do not delete legacy takeoff
-- tables during this milestone unless separately approved").
--
-- Adds to `manual_takeoffs`:
--   1. `client_key` — a stable idempotency key (the client-side shape id)
--      so a retried/duplicated save request upserts instead of duplicating
--      (PERMANENT RULE 13).
--   2. `updated_by`, `deleted_at` (soft delete — RULE 19: destructive
--      actions must be recoverable).
--   3. `document_id`, `document_version_id`, `sheet_revision_id` — additive
--      source-traceability columns the object model requires (STEP 2);
--      nullable/unbackfilled where genuinely unknown (RULE 18: unknown
--      values stay explicitly unknown, never fabricated).
--   4. A companion `manual_takeoff_history` append-only audit table,
--      mirroring the takeoff_item_history/estimate_audit_log/
--      sheet_corrections pattern already established in this codebase.
--
-- Geometry coordinate-space tagging (STEP 3 / PERMANENT RULE 1) is done
-- inside the existing `geometry` JSONB payload (`coordinate_space: 'page_space'
-- | 'legacy_pixel'`) rather than a new column, since the payload shape
-- already varies per takeoff_type and is the natural place a reader already
-- looks to interpret `points`. Existing rows are implicitly 'legacy_pixel'
-- (they predate this migration and were never tagged) — the application
-- layer treats an absent tag as 'legacy_pixel', not as an error, so no
-- existing data is misinterpreted or requires backfilling coordinates that
-- cannot be reconstructed.

alter table manual_takeoffs
  add column if not exists client_key            text,
  add column if not exists updated_by            text,
  add column if not exists deleted_at            timestamptz,
  add column if not exists document_id           text,
  add column if not exists document_version_id   uuid,
  add column if not exists sheet_revision_id     uuid;

-- Idempotency: retrying the same client-originated save must upsert, not
-- duplicate. Scoped per (tenant, project) since client_key is only unique
-- within one estimator's editing session for one project.
create unique index if not exists idx_manual_takeoffs_client_key
  on manual_takeoffs (tenant_id, project_id, client_key)
  where client_key is not null;

-- Soft-deleted rows must not appear in normal listings but must remain
-- queryable for audit/restore.
create index if not exists idx_manual_takeoffs_active
  on manual_takeoffs (tenant_id, project_id, page_id)
  where deleted_at is null;

create table if not exists manual_takeoff_history (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  project_id       uuid not null,
  manual_takeoff_id uuid not null,
  action           text not null check (action in ('created','updated','deleted','restored')),
  actor_user_id    text,
  before           jsonb,
  after            jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists idx_manual_takeoff_history_object
  on manual_takeoff_history(manual_takeoff_id, created_at);

comment on column manual_takeoff_history.manual_takeoff_id is
  'Intentionally NOT a foreign key to manual_takeoffs.id — mirrors takeoff_item_history''s documented design: history rows must survive a hard delete or future cleanup of the row they describe.';

alter table manual_takeoff_history enable row level security;
drop policy if exists manual_takeoff_history_service_role_only on manual_takeoff_history;
create policy manual_takeoff_history_service_role_only on manual_takeoff_history for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

comment on table manual_measurements is
  'DEPRECATED (professional-manual-takeoff milestone). Confirmed unreferenced by any application code (grepped app/components/lib) — manual_takeoffs + sheet_calibrations is the sole system actually in use. Left in place for historical reference only; do not add new writes here.';

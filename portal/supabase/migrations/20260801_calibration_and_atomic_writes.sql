-- Manual takeoff calibration + atomic-write hardening
-- (manual-takeoff-calibration-hardening milestone).
--
-- PART 1 — page-space calibration model
-- ---------------------------------------------------------------------------
-- Previous model: sheet_calibrations.scale_ratio is "real-world-units per
-- CURRENT-RENDER-pixel", computed client-side as
-- (known_distance_ft / distance_in_current_render_pixels) and sent to the
-- server as a bare number — the server never learns what render scale
-- produced it. If a user calibrates in one window size and later
-- draws/measures in a resized window, every quantity computed from
-- `pixelDistance * scale_ratio` is wrong by the ratio of the two render
-- scales. This is the exact class of bug PERMANENT RULE 1/2 (geometry) was
-- fixed for in the professional-manual-takeoff milestone, but calibration
-- itself was out of that scope — this migration closes the gap.
--
-- New model: calibration is defined by two PAGE-SPACE points (stable
-- regardless of window size/zoom — see lib/takeoff/canvas/coordinates.ts)
-- plus a known real-world distance between them. The authoritative
-- conversion factor, `page_space_scale_factor` (real-world units per
-- page-space unit), is computed and stored ONCE, server-side, from those
-- page-space points — never recomputed from current-render pixels.
--
-- Existing rows predate page-space points entirely — there is no way to
-- deterministically recover what render scale produced their scale_ratio
-- (STEP 4: "do not fabricate a conversion"), so they are marked
-- 'legacy_render_space' + inactive-for-new-approvals until a user
-- explicitly recalibrates (see LEGACY_MIGRATION_POLICY.md).

alter table sheet_calibrations
  add column if not exists project_id                uuid,
  add column if not exists point_a_x                 double precision,
  add column if not exists point_a_y                 double precision,
  add column if not exists point_b_x                 double precision,
  add column if not exists point_b_y                 double precision,
  add column if not exists known_distance             numeric,
  add column if not exists known_unit                 text,
  add column if not exists page_space_scale_factor    numeric,
  add column if not exists coordinate_system_version  text not null default 'v1',
  add column if not exists status                     text not null default 'legacy_render_space',
  add column if not exists verified                   boolean not null default false,
  add column if not exists active                     boolean not null default true;

alter table sheet_calibrations
  add constraint sheet_calibrations_status_check
  check (status in ('legacy_render_space', 'migrated', 'verified', 'needs_verification'));

-- Backfill: every pre-existing row predates page-space points. Mark
-- explicitly rather than silently treating scale_ratio as if it were
-- page-space-relative (that would be exactly the fabrication STEP 4
-- forbids). `verified = false` blocks new-approval/estimate-sync gating —
-- see the application-layer check in the save RPC below.
update sheet_calibrations
  set status = 'legacy_render_space', verified = false, active = true
  where page_space_scale_factor is null;

-- Backfill project_id via the page's parent document, for ownership checks
-- without an extra join at request time. Nullable — a page whose document
-- was since deleted leaves this null rather than fabricating a project.
update sheet_calibrations sc
  set project_id = d.project_id
  from document_pages dp
  join documents d on d.id = dp.document_id
  where sc.page_id = dp.id and sc.project_id is null;

create index if not exists idx_sheet_calibrations_project on sheet_calibrations(project_id);

create table if not exists sheet_calibration_history (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  project_id     uuid,
  calibration_id uuid not null,
  action         text not null check (action in ('created', 'recalibrated', 'migrated')),
  actor_user_id  text,
  before         jsonb,
  after          jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_sheet_calibration_history_object
  on sheet_calibration_history(calibration_id, created_at);
comment on column sheet_calibration_history.calibration_id is
  'Intentionally NOT a foreign key — mirrors manual_takeoff_history''s documented design: history must survive independent of the calibration row''s own lifecycle.';

alter table sheet_calibration_history enable row level security;
drop policy if exists sheet_calibration_history_service_role_only on sheet_calibration_history;
create policy sheet_calibration_history_service_role_only on sheet_calibration_history for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- PART 2 — server-authoritative calculation bookkeeping (STEP 6/7)
-- ---------------------------------------------------------------------------
alter table manual_takeoffs
  add column if not exists calculation_formula_version text,
  add column if not exists calculated_quantity          numeric,
  add column if not exists calculated_unit               text,
  add column if not exists calculated_at                 timestamptz;

-- PART 3 — deterministic source -> mirror linkage (STEP 9)
-- ---------------------------------------------------------------------------
-- takeoff_items previously linked back to its manual_takeoffs source only
-- via an untyped meta.manual_takeoff_id JSONB field (no constraint, no
-- index) — every "does this mirror still exist / update this exact mirror"
-- operation had to scan meta. A real column + unique partial index gives an
-- O(1), constraint-enforced one-mirror-per-source relationship.
alter table takeoff_items
  add column if not exists source_manual_takeoff_id uuid references manual_takeoffs(id);

create unique index if not exists idx_takeoff_items_source_manual_takeoff
  on takeoff_items (source_manual_takeoff_id)
  where source_manual_takeoff_id is not null;

-- Backfill existing mirrors created by the pre-atomic-write POST handler
-- from their meta.manual_takeoff_id, where present and unambiguous.
update takeoff_items ti
  set source_manual_takeoff_id = (ti.meta->>'manual_takeoff_id')::uuid
  where ti.source_manual_takeoff_id is null
    and ti.meta->>'manual_takeoff_id' is not null
    and (ti.meta->>'manual_takeoff_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from manual_takeoffs mt where mt.id = (ti.meta->>'manual_takeoff_id')::uuid);

-- PART 4 — durable outbox for estimate synchronization (STEP 8)
-- ---------------------------------------------------------------------------
-- syncTakeoffToEstimate is called today as a best-effort side-effect after
-- the (now-atomic) write commits — if it throws, the manual takeoff/mirror
-- are still correctly persisted, but the estimate never learns about the
-- change. This table makes that intent durable and re-driveable: every
-- create/update/delete writes a pending outbox row in the SAME transaction
-- as the business write, and a (currently synchronous, in-process) worker
-- processes it immediately after commit — see TRANSACTION_DESIGN.md for why
-- this is "transaction + outbox" rather than folding the sync itself into
-- the DB transaction (syncTakeoffToEstimate depends on cost-resolution
-- logic that isn't expressible in plpgsql without duplicating
-- lib/cost/resolver.ts).
create table if not exists estimate_sync_outbox (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  project_id        uuid not null,
  manual_takeoff_id uuid not null,
  event_type        text not null check (event_type in ('upsert', 'delete')),
  status            text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  payload           jsonb,
  attempts          integer not null default 0,
  last_error        text,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);
create index if not exists idx_estimate_sync_outbox_pending
  on estimate_sync_outbox(status, created_at) where status = 'pending';
-- At most one PENDING event per (manual_takeoff_id, event_type) — a rapid
-- string of edits before the worker runs collapses into one outbox row
-- (payload overwritten with the latest), not N duplicate sync attempts.
create unique index if not exists idx_estimate_sync_outbox_pending_dedup
  on estimate_sync_outbox(manual_takeoff_id, event_type)
  where status = 'pending';

alter table estimate_sync_outbox enable row level security;
drop policy if exists estimate_sync_outbox_service_role_only on estimate_sync_outbox;
create policy estimate_sync_outbox_service_role_only on estimate_sync_outbox for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- PART 5 — atomic save RPC
-- ---------------------------------------------------------------------------
-- One plpgsql function call is one implicit Postgres transaction — any
-- exception anywhere in this body rolls back every statement that ran
-- before it (manual_takeoffs upsert, its history, the takeoff_items mirror
-- upsert, its history, and the outbox insert), matching the same atomicity
-- guarantee apply_vision_extraction_takeoff_items already relies on
-- elsewhere in this codebase. Server-side ownership checks (tenant/project/
-- page) happen in the calling route BEFORE this RPC — this function trusts
-- the caller has already verified them, exactly like every other
-- SECURITY DEFINER RPC in this schema.
create or replace function save_manual_takeoff_tx(
  p_tenant_id uuid,
  p_project_id uuid,
  p_page_id uuid,
  p_cost_code text,
  p_takeoff_type text,
  p_quantity numeric,
  p_unit text,
  p_geometry jsonb,
  p_client_key text,
  p_actor_user_id text,
  p_calculation_formula_version text,
  p_is_vision_sourced boolean,
  p_label text
) returns table (manual_takeoff jsonb, mirror_takeoff_item_id uuid, was_update boolean) as $$
declare
  v_before      manual_takeoffs;
  v_row         manual_takeoffs;
  v_was_insert  boolean;
  v_mirror_id   uuid;
  v_mirror_before takeoff_items;
  v_division    text;
begin
  if p_client_key is null or length(p_client_key) = 0 then
    raise exception 'p_client_key is required';
  end if;
  if p_takeoff_type not in ('count', 'length', 'area') then
    raise exception 'invalid takeoff_type: %', p_takeoff_type;
  end if;

  select * into v_before from manual_takeoffs
    where tenant_id = p_tenant_id and project_id = p_project_id and client_key = p_client_key;

  if v_before.id is not null and v_before.deleted_at is not null then
    raise exception 'cannot save over a soft-deleted takeoff (id=%) — restore it explicitly first', v_before.id;
  end if;

  v_was_insert := (v_before.id is null);

  insert into manual_takeoffs (
    tenant_id, project_id, page_id, cost_code, takeoff_type, quantity, unit,
    geometry, client_key, created_by, updated_by, created_at,
    calculation_formula_version, calculated_quantity, calculated_unit, calculated_at
  ) values (
    p_tenant_id, p_project_id, p_page_id, p_cost_code, p_takeoff_type, p_quantity, p_unit,
    p_geometry, p_client_key, p_actor_user_id, p_actor_user_id, now(),
    p_calculation_formula_version, p_quantity, p_unit, now()
  )
  on conflict (tenant_id, project_id, client_key) do update set
    page_id = excluded.page_id,
    cost_code = excluded.cost_code,
    takeoff_type = excluded.takeoff_type,
    quantity = excluded.quantity,
    unit = excluded.unit,
    geometry = excluded.geometry,
    updated_by = excluded.updated_by,
    calculation_formula_version = excluded.calculation_formula_version,
    calculated_quantity = excluded.calculated_quantity,
    calculated_unit = excluded.calculated_unit,
    calculated_at = now()
  returning * into v_row;

  insert into manual_takeoff_history (tenant_id, project_id, manual_takeoff_id, action, actor_user_id, before, after)
  values (
    p_tenant_id, p_project_id, v_row.id,
    case when v_was_insert then 'created' else 'updated' end,
    p_actor_user_id,
    case when v_was_insert then null else to_jsonb(v_before) end,
    to_jsonb(v_row)
  );

  v_division := case when p_cost_code is not null then left(p_cost_code, 2) else null end;

  select * into v_mirror_before from takeoff_items where source_manual_takeoff_id = v_row.id;

  insert into takeoff_items (
    tenant_id, project_id, label, csi_code, division, quantity, unit, type, page,
    document_id, sheet_id, geometry, created_by, review_status, source_method, meta,
    source_manual_takeoff_id
  ) values (
    p_tenant_id, p_project_id, coalesce(p_label, 'Manual takeoff item'), p_cost_code, v_division,
    p_quantity, p_unit, 'takeoff_import', 0,
    p_page_id::text, p_page_id, p_geometry,
    case when p_is_vision_sourced then null else p_actor_user_id end,
    'approved',
    case when p_is_vision_sourced then 'ai_vision' else 'manual' end,
    jsonb_build_object('extraction_method', case when p_is_vision_sourced then 'ai_vision' else 'manual' end, 'manual_takeoff_id', v_row.id),
    v_row.id
  )
  on conflict (source_manual_takeoff_id) where source_manual_takeoff_id is not null do update set
    label = excluded.label, csi_code = excluded.csi_code, division = excluded.division,
    quantity = excluded.quantity, unit = excluded.unit, geometry = excluded.geometry,
    updated_by = p_actor_user_id, updated_at = now()
  returning id into v_mirror_id;

  insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
  values (
    p_tenant_id, p_project_id, v_mirror_id,
    case when v_mirror_before.id is null then 'created' else 'updated' end,
    p_actor_user_id,
    case when v_mirror_before.id is null then null else to_jsonb(v_mirror_before) end,
    jsonb_build_object('source', 'manual_canvas', 'manual_takeoff_id', v_row.id)
  );

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (p_tenant_id, p_project_id, v_row.id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
  on conflict (manual_takeoff_id, event_type) where status = 'pending' do update set
    payload = excluded.payload, created_at = now();

  return query select to_jsonb(v_row), v_mirror_id, (not v_was_insert);
end;
$$ language plpgsql security definer set search_path = public;

-- PART 6 — atomic soft-delete RPC
-- ---------------------------------------------------------------------------
create or replace function soft_delete_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text
) returns table (already_deleted boolean, manual_takeoff jsonb) as $$
declare
  v_before manual_takeoffs;
  v_after  manual_takeoffs;
  v_mirror_id uuid;
begin
  select * into v_before from manual_takeoffs where id = p_id and tenant_id = p_tenant_id;
  if v_before.id is null then
    raise exception 'manual takeoff % not found for this tenant', p_id;
  end if;

  if v_before.deleted_at is not null then
    return query select true, to_jsonb(v_before);
    return;
  end if;

  update manual_takeoffs set deleted_at = now(), updated_by = p_actor_user_id
    where id = p_id and tenant_id = p_tenant_id
    returning * into v_after;

  insert into manual_takeoff_history (tenant_id, project_id, manual_takeoff_id, action, actor_user_id, before, after)
  values (p_tenant_id, v_after.project_id, p_id, 'deleted', p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after));

  -- The mirror is hard-deleted, consistent with takeoff_items' existing
  -- delete semantics elsewhere in this codebase (see
  -- takeoff-integrity.integration.test.ts) — manual_takeoffs is the one
  -- getting NEW soft-delete/audit behavior in this milestone, not
  -- takeoff_items. Its own history table has no FK to it, so the audit
  -- record survives the hard delete (documented pattern).
  select id into v_mirror_id from takeoff_items where source_manual_takeoff_id = p_id;
  if v_mirror_id is not null then
    insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before)
      select p_tenant_id, v_after.project_id, ti.id, 'deleted', p_actor_user_id, to_jsonb(ti)
      from takeoff_items ti where ti.id = v_mirror_id;
    delete from takeoff_items where id = v_mirror_id;
  end if;

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (p_tenant_id, v_after.project_id, p_id, 'delete', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
  on conflict (manual_takeoff_id, event_type) where status = 'pending' do update set
    payload = excluded.payload, created_at = now();

  return query select false, to_jsonb(v_after);
end;
$$ language plpgsql security definer set search_path = public;

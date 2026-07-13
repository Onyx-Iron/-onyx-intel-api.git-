-- Manual takeoff productivity + outbox reliability
-- (manual-takeoff-productivity milestone).
--
-- PART 1 — optimistic concurrency (STEP 2)
-- ---------------------------------------------------------------------------
-- Editing an ALREADY-SAVED object was previously only possible by re-running
-- save_manual_takeoff_tx keyed on client_key, which always blindly
-- overwrites (last-write-wins) — there was no way to detect that someone
-- else's edit landed in between a client loading a row and submitting a
-- change to it. row_version closes that gap: every update must supply the
-- version it read, and the update is rejected (a structured conflict, not
-- silently applied) if the stored version has moved on.
alter table manual_takeoffs
  add column if not exists row_version integer not null default 1;

-- PART 2 — outbox worker fields (STEP 14)
-- ---------------------------------------------------------------------------
-- estimate_sync_outbox previously only had pending/processed/failed with no
-- claim mechanism — two concurrent processing attempts on the same row were
-- possible, there was no backoff/attempt-limit, and a crashed worker mid-
-- process would leave a row silently stuck. These columns support: atomic
-- claim (claimed_at/claimed_by + FOR UPDATE SKIP LOCKED), reclaiming
-- abandoned rows after a visibility timeout, exponential backoff
-- (next_attempt_at), and a dead-letter terminal state after max attempts.
alter table estimate_sync_outbox
  add column if not exists claimed_at      timestamptz,
  add column if not exists claimed_by      text,
  add column if not exists next_attempt_at timestamptz;

alter table estimate_sync_outbox drop constraint if exists estimate_sync_outbox_status_check;
alter table estimate_sync_outbox add constraint estimate_sync_outbox_status_check
  check (status in ('pending', 'processing', 'processed', 'failed', 'dead_letter'));

-- The old dedup index only covered 'pending' — a row now also legitimately
-- sits in 'processing' while being worked, so the "one active event per
-- (manual_takeoff_id, event_type)" guarantee needs to cover both states, or
-- a fresh save mid-processing could insert a second competing event.
drop index if exists idx_estimate_sync_outbox_pending_dedup;
create unique index if not exists idx_estimate_sync_outbox_active_dedup
  on estimate_sync_outbox(manual_takeoff_id, event_type)
  where status in ('pending', 'processing');

create index if not exists idx_estimate_sync_outbox_claimable
  on estimate_sync_outbox(status, next_attempt_at)
  where status = 'pending';
create index if not exists idx_estimate_sync_outbox_stuck_processing
  on estimate_sync_outbox(status, claimed_at)
  where status = 'processing';

-- PART 3 — atomic update-with-conflict-detection RPC
-- ---------------------------------------------------------------------------
create or replace function update_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_expected_row_version integer,
  p_geometry jsonb,
  p_quantity numeric,
  p_unit text,
  p_cost_code text,
  p_actor_user_id text,
  p_calculation_formula_version text
) returns table (conflict boolean, manual_takeoff jsonb, mirror_takeoff_item_id uuid) as $$
declare
  v_before manual_takeoffs;
  v_after  manual_takeoffs;
  v_division text;
  v_mirror_id uuid;
  v_mirror_before takeoff_items;
begin
  select * into v_before from manual_takeoffs where id = p_id and tenant_id = p_tenant_id;
  if v_before.id is null then
    raise exception 'manual takeoff % not found for this tenant', p_id;
  end if;
  if v_before.deleted_at is not null then
    raise exception 'cannot edit a soft-deleted takeoff (id=%) — restore it explicitly first', p_id;
  end if;

  if v_before.row_version != p_expected_row_version then
    -- Structured conflict, NOT an exception: the caller submitted a change
    -- against a stale version. Nothing is applied — return the current
    -- authoritative row so the client can offer reload/discard/save-as-new.
    return query select true, to_jsonb(v_before), (select id from takeoff_items where source_manual_takeoff_id = p_id);
    return;
  end if;

  update manual_takeoffs set
    geometry = p_geometry,
    quantity = p_quantity,
    unit = p_unit,
    cost_code = p_cost_code,
    row_version = row_version + 1,
    updated_by = p_actor_user_id,
    calculation_formula_version = coalesce(p_calculation_formula_version, calculation_formula_version),
    calculated_quantity = p_quantity,
    calculated_unit = p_unit,
    calculated_at = now()
  where id = p_id and tenant_id = p_tenant_id and row_version = p_expected_row_version
  returning * into v_after;

  if v_after.id is null then
    -- Lost a race between our SELECT above and this UPDATE (another writer
    -- committed in between) — same structured-conflict response, not a
    -- silent overwrite and not an exception.
    select * into v_before from manual_takeoffs where id = p_id and tenant_id = p_tenant_id;
    return query select true, to_jsonb(v_before), (select id from takeoff_items where source_manual_takeoff_id = p_id);
    return;
  end if;

  insert into manual_takeoff_history (tenant_id, project_id, manual_takeoff_id, action, actor_user_id, before, after)
  values (p_tenant_id, v_after.project_id, p_id, 'updated', p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after));

  v_division := case when p_cost_code is not null then left(p_cost_code, 2) else null end;
  select * into v_mirror_before from takeoff_items where source_manual_takeoff_id = p_id;

  if v_mirror_before.id is not null then
    update takeoff_items set
      quantity = p_quantity, unit = p_unit, csi_code = p_cost_code, division = v_division,
      geometry = p_geometry, updated_by = p_actor_user_id, updated_at = now()
    where id = v_mirror_before.id
    returning id into v_mirror_id;

    insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
    values (p_tenant_id, v_after.project_id, v_mirror_id, 'updated', p_actor_user_id, to_jsonb(v_mirror_before), jsonb_build_object('source', 'manual_canvas_edit', 'manual_takeoff_id', p_id));
  end if;

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (p_tenant_id, v_after.project_id, p_id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
  on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;

  return query select false, to_jsonb(v_after), v_mirror_id;
end;
$$ language plpgsql security definer set search_path = public;

-- PART 4 — outbox claim / complete / fail / retry RPCs
-- ---------------------------------------------------------------------------
-- Atomic claim: FOR UPDATE SKIP LOCKED means two concurrent worker
-- invocations can never claim the same row — the second one simply skips
-- whatever the first has already locked, rather than blocking or double-
-- claiming. Also reclaims 'processing' rows whose claim has been held
-- longer than p_visibility_timeout_seconds (a worker that crashed or timed
-- out mid-process without marking the row complete/failed).
create or replace function claim_outbox_events(
  p_limit integer,
  p_worker_id text,
  p_visibility_timeout_seconds integer default 120
) returns setof estimate_sync_outbox as $$
begin
  return query
  update estimate_sync_outbox
  set status = 'processing', claimed_at = now(), claimed_by = p_worker_id
  where id in (
    select id from estimate_sync_outbox
    where (status = 'pending' and (next_attempt_at is null or next_attempt_at <= now()))
       or (status = 'processing' and claimed_at < now() - make_interval(secs => p_visibility_timeout_seconds))
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function complete_outbox_event(p_id uuid) returns void as $$
  update estimate_sync_outbox set status = 'processed', processed_at = now() where id = p_id;
$$ language sql security definer set search_path = public;

-- Exponential backoff: 30s, 60s, 120s, 240s, capped at 1 hour. Terminal
-- 'dead_letter' state after p_max_attempts — a dead-lettered event stays
-- visible/queryable (never deleted) and requires an explicit manual retry
-- (retry_outbox_event) rather than being auto-retried forever.
create or replace function fail_outbox_event(
  p_id uuid,
  p_error text,
  p_max_attempts integer default 5
) returns void as $$
declare
  v_attempts integer;
begin
  update estimate_sync_outbox
  set attempts = attempts + 1, last_error = p_error
  where id = p_id
  returning attempts into v_attempts;

  if v_attempts >= p_max_attempts then
    update estimate_sync_outbox set status = 'dead_letter' where id = p_id;
  else
    update estimate_sync_outbox
    set status = 'pending', next_attempt_at = now() + make_interval(secs => least(2 ^ v_attempts * 30, 3600))
    where id = p_id;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function retry_outbox_event(p_id uuid, p_tenant_id uuid) returns void as $$
begin
  update estimate_sync_outbox
  set status = 'pending', attempts = 0, next_attempt_at = null, last_error = null, claimed_at = null, claimed_by = null
  where id = p_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'outbox event % not found for this tenant', p_id;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- PART 5 — fix save_manual_takeoff_tx / soft_delete_manual_takeoff_tx's
-- outbox ON CONFLICT predicate to match the new active-state dedup index
-- (Part 2 dropped idx_estimate_sync_outbox_pending_dedup, which their
-- existing `where status = 'pending'` conflict targets depended on).
-- ---------------------------------------------------------------------------
create or replace function save_manual_takeoff_tx(
  p_tenant_id uuid,
  p_project_id uuid,
  p_page_id uuid,
  p_document_id uuid,
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
    calculated_at = now(),
    row_version = manual_takeoffs.row_version + 1
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
    p_document_id, p_page_id, p_geometry,
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
  on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;

  return query select to_jsonb(v_row), v_mirror_id, (not v_was_insert);
end;
$$ language plpgsql security definer set search_path = public;

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

  select id into v_mirror_id from takeoff_items where source_manual_takeoff_id = p_id;
  if v_mirror_id is not null then
    insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before)
      select p_tenant_id, v_after.project_id, ti.id, 'deleted', p_actor_user_id, to_jsonb(ti)
      from takeoff_items ti where ti.id = v_mirror_id;
    delete from takeoff_items where id = v_mirror_id;
  end if;

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (p_tenant_id, v_after.project_id, p_id, 'delete', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
  on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;

  return query select false, to_jsonb(v_after);
end;
$$ language plpgsql security definer set search_path = public;

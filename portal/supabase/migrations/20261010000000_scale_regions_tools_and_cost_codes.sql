-- Scale regions, a project tool chest, and cost codes on changes, POs, and invoices.
-- A measurement syncs when its geometry names a verified scale region, or when
-- it names no region and the sheet scale is verified.

create table if not exists public.sheet_scale_regions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_id uuid not null,
  polygon jsonb not null,
  label text,
  page_space_scale_factor numeric,
  verified boolean not null default false,
  known_distance numeric,
  known_unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sheet_scale_regions_page
  on public.sheet_scale_regions(tenant_id, project_id, page_id);

alter table public.sheet_scale_regions enable row level security;
drop policy if exists sheet_scale_regions_service_role_all on public.sheet_scale_regions;
create policy sheet_scale_regions_service_role_all
  on public.sheet_scale_regions for all to service_role
  using (true) with check (true);
revoke all on table public.sheet_scale_regions from anon, authenticated;
grant select, insert, update, delete on table public.sheet_scale_regions to service_role;

create table if not exists public.takeoff_tools (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  cost_code text not null,
  unit text not null,
  tool text not null check (tool in ('count', 'length', 'area')),
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_takeoff_tools_project
  on public.takeoff_tools(tenant_id, project_id, name);

alter table public.takeoff_tools enable row level security;
drop policy if exists takeoff_tools_service_role_all on public.takeoff_tools;
create policy takeoff_tools_service_role_all
  on public.takeoff_tools for all to service_role
  using (true) with check (true);
revoke all on table public.takeoff_tools from anon, authenticated;
grant select, insert, update, delete on table public.takeoff_tools to service_role;

alter table public.change_order_items add column if not exists cost_code text;
alter table public.purchase_orders add column if not exists cost_code text;
alter table public.invoices add column if not exists cost_code text;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'sheet_markups'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%markup_type%'
  loop
    execute format('alter table public.sheet_markups drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.sheet_markups
  add constraint sheet_markups_markup_type_check
  check (markup_type in ('cloud', 'text', 'highlight', 'pen', 'pin'));

create or replace function public.measurement_has_verified_scale(
  p_tenant_id uuid,
  p_page_id uuid,
  p_geometry jsonb
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_geometry is not null and nullif(p_geometry->>'scale_region_id', '') is not null then exists (
      select 1
      from public.sheet_scale_regions r
      where r.tenant_id = p_tenant_id
        and r.page_id = p_page_id
        and r.id::text = p_geometry->>'scale_region_id'
        and r.verified = true
        and r.page_space_scale_factor is not null
    )
    else public.sheet_has_verified_scale(p_tenant_id, p_page_id)
  end;
$$;

revoke all on function public.measurement_has_verified_scale(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.measurement_has_verified_scale(uuid, uuid, jsonb) to service_role;

create or replace function public.save_manual_takeoff_tx(
  p_tenant_id uuid,
  p_project_id uuid,
  p_page_id uuid,
  p_document_id text,
  p_cost_code text,
  p_takeoff_type text,
  p_quantity numeric,
  p_unit text,
  p_geometry jsonb,
  p_client_key text,
  p_actor_user_id text,
  p_calculation_formula_version text,
  p_is_vision_sourced boolean,
  p_label text,
  p_layer_id uuid default null
) returns table (manual_takeoff jsonb, mirror_takeoff_item_id uuid, was_update boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before      manual_takeoffs;
  v_row         manual_takeoffs;
  v_was_insert  boolean;
  v_mirror_id   uuid;
  v_mirror_before takeoff_items;
  v_division    text;
  v_review_status text;
  v_origin_actor text;
  v_origin_method text;
  v_mirror_status text;
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
    calculation_formula_version, calculated_quantity, calculated_unit, calculated_at,
    layer_id
  ) values (
    p_tenant_id, p_project_id, p_page_id, p_cost_code, p_takeoff_type, p_quantity, p_unit,
    p_geometry, p_client_key, p_actor_user_id, p_actor_user_id, now(),
    p_calculation_formula_version,
    case when p_calculation_formula_version is not null then p_quantity else null end,
    case when p_calculation_formula_version is not null then p_unit else null end,
    case when p_calculation_formula_version is not null then now() else null end,
    p_layer_id
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
    calculated_at = excluded.calculated_at,
    layer_id = coalesce(excluded.layer_id, manual_takeoffs.layer_id),
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
  v_origin_actor := case when p_is_vision_sourced then 'agent' else 'human' end;
  v_origin_method := case when p_is_vision_sourced then 'vision' else 'manual' end;
  v_review_status := case when p_is_vision_sourced then 'suggested' else 'approved' end;

  select * into v_mirror_before from takeoff_items where source_manual_takeoff_id = v_row.id;

  insert into takeoff_items (
    tenant_id, project_id, label, csi_code, division, quantity, unit, type, page,
    document_id, sheet_id, geometry, created_by, review_status, source_method, meta,
    source_manual_takeoff_id, origin_actor, origin_method, origin_edited
  ) values (
    p_tenant_id, p_project_id, coalesce(p_label, 'Manual takeoff item'), p_cost_code, v_division,
    p_quantity, p_unit, 'takeoff_import', 0,
    p_document_id, p_page_id, p_geometry,
    case when p_is_vision_sourced then null else p_actor_user_id end,
    v_review_status,
    case when p_is_vision_sourced then 'ai_vision' else 'manual' end,
    jsonb_build_object(
      'extraction_method', case when p_is_vision_sourced then 'ai_vision' else 'manual' end,
      'manual_takeoff_id', v_row.id,
      'origin_actor', v_origin_actor,
      'origin_method', v_origin_method
    ),
    v_row.id,
    v_origin_actor,
    v_origin_method,
    false
  )
  on conflict (source_manual_takeoff_id) where source_manual_takeoff_id is not null do update set
    label = excluded.label,
    csi_code = excluded.csi_code,
    division = excluded.division,
    quantity = excluded.quantity,
    unit = excluded.unit,
    geometry = excluded.geometry,
    updated_by = p_actor_user_id,
    updated_at = now(),
    review_status = case
      when takeoff_items.review_status in ('approved', 'rejected') then takeoff_items.review_status
      when p_is_vision_sourced then 'suggested'
      else 'approved'
    end,
    origin_actor = coalesce(takeoff_items.origin_actor, excluded.origin_actor),
    origin_method = coalesce(takeoff_items.origin_method, excluded.origin_method),
    origin_edited = case
      when takeoff_items.origin_actor = 'agent' and not p_is_vision_sourced then true
      else takeoff_items.origin_edited
    end,
    meta = takeoff_items.meta || jsonb_build_object(
      'extraction_method', case when p_is_vision_sourced then 'ai_vision' else coalesce(takeoff_items.source_method, 'manual') end,
      'manual_takeoff_id', v_row.id,
      'origin_edited', case
        when takeoff_items.origin_actor = 'agent' and not p_is_vision_sourced then true
        else coalesce((takeoff_items.meta->>'origin_edited')::boolean, false)
      end
    )
  returning id into v_mirror_id;

  insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
  values (
    p_tenant_id, p_project_id, v_mirror_id,
    case when v_mirror_before.id is null then 'created' else 'updated' end,
    p_actor_user_id,
    case when v_mirror_before.id is null then null else to_jsonb(v_mirror_before) end,
    jsonb_build_object(
      'source', 'manual_canvas',
      'manual_takeoff_id', v_row.id,
      'origin_actor', v_origin_actor,
      'origin_method', v_origin_method
    )
  );

  select review_status into v_mirror_status from takeoff_items where id = v_mirror_id;

  if v_mirror_status = 'approved' and public.measurement_has_verified_scale(p_tenant_id, v_row.page_id, v_row.geometry) then
    insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
    values (p_tenant_id, p_project_id, v_row.id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
    on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
      status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;
  end if;

  return query select to_jsonb(v_row), v_mirror_id, (not v_was_insert);
end;
$$;

revoke all on function public.save_manual_takeoff_tx(uuid, uuid, uuid, text, text, text, numeric, text, jsonb, text, text, text, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.save_manual_takeoff_tx(uuid, uuid, uuid, text, text, text, numeric, text, jsonb, text, text, text, boolean, text, uuid) to service_role;

drop function if exists public.update_manual_takeoff_tx(uuid, uuid, integer, jsonb, numeric, text, text, text, text);

create or replace function public.update_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_expected_row_version integer,
  p_geometry jsonb,
  p_quantity numeric,
  p_unit text,
  p_cost_code text,
  p_actor_user_id text,
  p_calculation_formula_version text,
  p_layer_id uuid default null
) returns table (conflict boolean, manual_takeoff jsonb, mirror_takeoff_item_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before manual_takeoffs;
  v_after  manual_takeoffs;
  v_division text;
  v_mirror_id uuid;
  v_mirror_before takeoff_items;
  v_mirror_status text;
begin
  select * into v_before from manual_takeoffs where id = p_id and tenant_id = p_tenant_id;
  if v_before.id is null then
    raise exception 'manual takeoff % not found for this tenant', p_id;
  end if;
  if v_before.deleted_at is not null then
    raise exception 'cannot edit a soft-deleted takeoff (id=%) — restore it explicitly first', p_id;
  end if;

  if v_before.row_version != p_expected_row_version then
    return query select true, to_jsonb(v_before), (select id from takeoff_items where source_manual_takeoff_id = p_id);
    return;
  end if;

  update manual_takeoffs set
    geometry = p_geometry,
    quantity = p_quantity,
    unit = p_unit,
    cost_code = p_cost_code,
    layer_id = coalesce(p_layer_id, layer_id),
    row_version = row_version + 1,
    updated_by = p_actor_user_id,
    calculation_formula_version = p_calculation_formula_version,
    calculated_quantity = case when p_calculation_formula_version is not null then p_quantity else null end,
    calculated_unit = case when p_calculation_formula_version is not null then p_unit else null end,
    calculated_at = case when p_calculation_formula_version is not null then now() else null end
  where id = p_id and tenant_id = p_tenant_id and row_version = p_expected_row_version
  returning * into v_after;

  if v_after.id is null then
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

    select review_status into v_mirror_status from takeoff_items where id = v_mirror_id;
  end if;

  if v_mirror_status = 'approved' and public.measurement_has_verified_scale(p_tenant_id, v_after.page_id, v_after.geometry) then
    insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
    values (p_tenant_id, v_after.project_id, p_id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
    on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
      status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;
  end if;

  return query select false, to_jsonb(v_after), v_mirror_id;
end;
$$;

revoke all on function public.update_manual_takeoff_tx(uuid, uuid, integer, jsonb, numeric, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.update_manual_takeoff_tx(uuid, uuid, integer, jsonb, numeric, text, text, text, text, uuid) to service_role;


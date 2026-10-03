-- OSS-04 / OSS-05: measurement provenance + hard AI approval gate.
--
-- Adds origin_actor / origin_method / origin_edited on takeoff_items so every
-- row records who/what created it (human | agent | deterministic_parser).
-- Reuses existing review_status + approved_by/approved_at as the human seal
-- (no second approval_status column that can disagree).
--
-- Fixes the critical gap in save_manual_takeoff_tx / restore_manual_takeoff_tx:
-- vision-sourced mirrors were hardcoded review_status='approved' and always
-- enqueued estimate sync. They must land as 'suggested' and only reach the
-- estimate after an explicit human approve action.

alter table public.takeoff_items
  add column if not exists origin_actor text,
  add column if not exists origin_method text,
  add column if not exists origin_edited boolean not null default false;

alter table public.takeoff_items drop constraint if exists takeoff_items_origin_actor_check;
alter table public.takeoff_items
  add constraint takeoff_items_origin_actor_check
  check (origin_actor is null or origin_actor in ('human', 'agent', 'deterministic_parser'));

-- Backfill from existing source_method / review signals.
update public.takeoff_items
set
  origin_actor = case
    when source_method in ('ai_vision', 'vision') then 'agent'
    when source_method in ('civil_calculator', 'deterministic', 'pdf_table', 'dxf', 'ifc', 'xlsx')
      then 'deterministic_parser'
    when created_by is not null or source_method = 'manual' then 'human'
    else 'deterministic_parser'
  end,
  origin_method = coalesce(source_method, meta->>'extraction_method', 'legacy_unknown')
where origin_actor is null;

create index if not exists idx_takeoff_items_origin_actor
  on public.takeoff_items (tenant_id, project_id, origin_actor);

-- ── save_manual_takeoff_tx: vision → suggested, skip outbox until approved ──
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
    -- Preserve human seals; never silently re-approve AI rows on re-save.
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

  -- Estimate sync only for human-sealed (approved) mirrors.
  if v_mirror_status = 'approved' then
    insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
    values (p_tenant_id, p_project_id, v_row.id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
    on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
      status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;
  end if;

  return query select to_jsonb(v_row), v_mirror_id, (not v_was_insert);
end;
$$ language plpgsql security definer set search_path = public;

-- ── restore_manual_takeoff_tx: same vision gate ─────────────────────────────
create or replace function restore_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text
) returns table (already_active boolean, manual_takeoff jsonb, mirror_takeoff_item_id uuid) as $$
declare
  v_before manual_takeoffs;
  v_after  manual_takeoffs;
  v_mirror_id uuid;
  v_mirror_before takeoff_items;
  v_division text;
  v_label text;
  v_is_vision boolean;
  v_review_status text;
  v_origin_actor text;
  v_origin_method text;
  v_mirror_status text;
begin
  select * into v_before from manual_takeoffs where id = p_id and tenant_id = p_tenant_id;
  if v_before.id is null then
    raise exception 'manual takeoff % not found for this tenant', p_id;
  end if;

  if v_before.deleted_at is null then
    select id into v_mirror_id from takeoff_items where source_manual_takeoff_id = p_id;
    return query select true, to_jsonb(v_before), v_mirror_id;
    return;
  end if;

  update manual_takeoffs
    set deleted_at = null, updated_by = p_actor_user_id, updated_at = now(),
        row_version = row_version + 1
    where id = p_id and tenant_id = p_tenant_id
    returning * into v_after;

  insert into manual_takeoff_history (tenant_id, project_id, manual_takeoff_id, action, actor_user_id, before, after)
  values (p_tenant_id, v_after.project_id, p_id, 'restored', p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after));

  v_division := case when v_after.cost_code is not null then left(v_after.cost_code, 2) else null end;
  v_label := coalesce(v_after.geometry->>'label', 'Manual takeoff item');
  v_is_vision := coalesce((v_after.geometry->>'is_vision_sourced')::boolean, false);
  v_origin_actor := case when v_is_vision then 'agent' else 'human' end;
  v_origin_method := case when v_is_vision then 'vision' else 'manual' end;
  v_review_status := case when v_is_vision then 'suggested' else 'approved' end;

  select * into v_mirror_before from takeoff_items where source_manual_takeoff_id = v_after.id;

  insert into takeoff_items (
    tenant_id, project_id, label, csi_code, division, quantity, unit, type, page,
    document_id, sheet_id, geometry, created_by, review_status, source_method, meta,
    source_manual_takeoff_id, origin_actor, origin_method, origin_edited
  ) values (
    p_tenant_id, v_after.project_id, v_label, v_after.cost_code, v_division,
    v_after.quantity, v_after.unit, 'takeoff_import', 0,
    null, v_after.page_id, v_after.geometry,
    case when v_is_vision then null else p_actor_user_id end,
    v_review_status,
    case when v_is_vision then 'ai_vision' else 'manual' end,
    jsonb_build_object(
      'extraction_method', case when v_is_vision then 'ai_vision' else 'manual' end,
      'manual_takeoff_id', v_after.id,
      'origin_actor', v_origin_actor,
      'origin_method', v_origin_method
    ),
    v_after.id,
    v_origin_actor,
    v_origin_method,
    false
  )
  on conflict (source_manual_takeoff_id) where source_manual_takeoff_id is not null do update set
    label = excluded.label, csi_code = excluded.csi_code, division = excluded.division,
    quantity = excluded.quantity, unit = excluded.unit, geometry = excluded.geometry,
    updated_by = p_actor_user_id, updated_at = now(),
    review_status = case
      when takeoff_items.review_status in ('approved', 'rejected') then takeoff_items.review_status
      when v_is_vision then 'suggested'
      else 'approved'
    end,
    origin_actor = coalesce(takeoff_items.origin_actor, excluded.origin_actor),
    origin_method = coalesce(takeoff_items.origin_method, excluded.origin_method)
  returning id into v_mirror_id;

  insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
  values (
    p_tenant_id, v_after.project_id, v_mirror_id,
    case when v_mirror_before.id is null then 'created' else 'updated' end,
    p_actor_user_id,
    case when v_mirror_before.id is null then null else to_jsonb(v_mirror_before) end,
    jsonb_build_object(
      'source', 'manual_canvas_restore',
      'manual_takeoff_id', v_after.id,
      'origin_actor', v_origin_actor
    )
  );

  select review_status into v_mirror_status from takeoff_items where id = v_mirror_id;

  if v_mirror_status = 'approved' then
    insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
    values (
      p_tenant_id, v_after.project_id, v_after.id, 'upsert', 'pending',
      jsonb_build_object('mirror_id', v_mirror_id, 'restored', true), now()
    )
    on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
      status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;
  end if;

  return query select false, to_jsonb(v_after), v_mirror_id;
end;
$$ language plpgsql security definer set search_path = public;

REVOKE EXECUTE ON FUNCTION public.restore_manual_takeoff_tx(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_manual_takeoff_tx(uuid, uuid, text) TO service_role;

-- ── apply_vision_extraction_takeoff_items: stamp origin columns ─────────────
create or replace function apply_vision_extraction_takeoff_items(
  p_tenant_id uuid,
  p_project_id uuid,
  p_document_id uuid,
  p_page_id uuid,
  p_page_number int,
  p_items jsonb
) returns setof takeoff_items
language plpgsql
security invoker
set search_path = public
as $$
declare
  decided_keys text[];
  deleted_row takeoff_items%rowtype;
  item jsonb;
  item_key text;
  new_id uuid;
begin
  select coalesce(array_agg(
    lower(trim(label)) || '|' || round(coalesce(quantity, 0), 4)::text || '|' || lower(trim(coalesce(unit, '')))
  ), array[]::text[])
  into decided_keys
  from takeoff_items
  where tenant_id = p_tenant_id
    and document_id = p_document_id::text
    and (meta->>'vision_page_id') = p_page_id::text
    and review_status in ('approved', 'rejected');

  for deleted_row in
    delete from takeoff_items
    where tenant_id = p_tenant_id
      and document_id = p_document_id::text
      and (meta->>'vision_page_id') = p_page_id::text
      and review_status in ('suggested', 'reviewed')
    returning *
  loop
    insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before)
    values (p_tenant_id, p_project_id, deleted_row.id, 'deleted', null, to_jsonb(deleted_row));
  end loop;

  for item in select * from jsonb_array_elements(p_items)
  loop
    item_key := lower(trim(coalesce(item->>'description', ''))) || '|'
      || round(coalesce((item->>'quantity')::numeric, 0), 4)::text || '|'
      || lower(trim(coalesce(item->>'unit', '')));
    if item_key = any(decided_keys) then continue; end if;

    new_id := gen_random_uuid();
    insert into takeoff_items (
      id, tenant_id, project_id, label, csi_code, division, quantity, unit,
      type, page, document_id, sheet_id, created_by, review_status,
      source_method, confidence_score, geometry, meta,
      origin_actor, origin_method, origin_edited
    ) values (
      new_id, p_tenant_id, p_project_id,
      coalesce(item->>'description', 'Vision-extracted item'),
      item->>'cost_code',
      case when item->>'cost_code' is not null then left(item->>'cost_code', 2) else null end,
      (item->>'quantity')::numeric, item->>'unit',
      'takeoff_import', p_page_number, p_document_id::text, p_page_id,
      null, 'suggested', 'ai_vision', (item->>'confidence')::numeric, null,
      jsonb_build_object(
        'trade', null, 'quantity_basis', item->>'raw_text', 'drawing_ref', item->>'layer_hint',
        'location_tag', null, 'extraction_method', 'ai_vision', 'vision_source', item->>'source',
        'vision_page_id', p_page_id::text, 'confidence', (item->>'confidence')::numeric,
        'geometry_unavailable', true, 'item_key', item_key,
        'origin_actor', 'agent', 'origin_method', 'vision'
      ),
      'agent', 'vision', false
    )
    on conflict (tenant_id, document_id, (meta->>'vision_page_id'), (meta->>'item_key'))
    where review_status in ('suggested', 'reviewed')
    do nothing;

    if found then
      insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, after)
      values (p_tenant_id, p_project_id, new_id, 'created', null, jsonb_build_object('source', 'ai_vision', 'page_id', p_page_id, 'origin_actor', 'agent'));
    end if;
  end loop;

  return query
    select * from takeoff_items
    where tenant_id = p_tenant_id and document_id = p_document_id::text
      and (meta->>'vision_page_id') = p_page_id::text;
end;
$$;

-- Unscaled measurements persist with a null calculated_quantity.
-- Vision findings keep a null quantity unless the source is a schedule count.
-- Estimate sync is unchanged: approved mirror and a verified scale.

drop function if exists public.save_manual_takeoff_tx(uuid, uuid, uuid, uuid, text, text, numeric, text, jsonb, text, text, text, boolean, text);

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

  if v_mirror_status = 'approved' and public.sheet_has_verified_scale(p_tenant_id, v_row.page_id) then
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

  if v_mirror_status = 'approved' and public.sheet_has_verified_scale(p_tenant_id, v_after.page_id) then
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

drop function if exists public.apply_vision_extraction_takeoff_items(uuid, uuid, uuid, uuid, integer, jsonb);

create or replace function public.apply_vision_extraction_takeoff_items(
  p_tenant_id uuid,
  p_project_id uuid,
  p_document_id text,
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
    and document_id = p_document_id
    and (meta->>'vision_page_id') = p_page_id::text
    and review_status in ('approved', 'rejected');

  for deleted_row in
    delete from takeoff_items
    where tenant_id = p_tenant_id
      and document_id = p_document_id
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
      case
        when lower(coalesce(item->>'source', '')) = 'schedule' then (item->>'quantity')::numeric
        else null
      end,
      item->>'unit',
      'takeoff_import', p_page_number, p_document_id, p_page_id,
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
    where tenant_id = p_tenant_id and document_id = p_document_id
      and (meta->>'vision_page_id') = p_page_id::text;
end;
$$;

revoke all on function public.apply_vision_extraction_takeoff_items(uuid, uuid, text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.apply_vision_extraction_takeoff_items(uuid, uuid, text, uuid, integer, jsonb) to service_role;


notify pgrst, 'reload schema';

-- Fix: save_manual_takeoff_tx (20260801_calibration_and_atomic_writes.sql)
-- inherited a pre-existing bug from app/api/takeoff/canvas/manual/route.ts's
-- original takeoff_items mirror insert — it wrote the PAGE id
-- (document_pages.id) into takeoff_items.document_id, which has a foreign
-- key to documents(id), not document_pages(id). Any manual-canvas save that
-- included a page_id (the normal case — SheetCanvas always sends one) would
-- throw a foreign-key violation. Caught by a live-database smoke test of
-- the new RPC before it was ever wired into the route — never shipped.
--
-- Fix: the RPC now takes the actual document_id as its own parameter
-- (resolved by the calling route from document_pages.document_id, which it
-- already looks up during assertPageBelongsToProject) and uses page_id only
-- for `sheet_id` — matching what document_id/sheet_id are each actually
-- supposed to reference.

drop function if exists save_manual_takeoff_tx(uuid, uuid, uuid, text, text, numeric, text, jsonb, text, text, text, boolean, text);

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
  on conflict (manual_takeoff_id, event_type) where status = 'pending' do update set
    payload = excluded.payload, created_at = now();

  return query select to_jsonb(v_row), v_mirror_id, (not v_was_insert);
end;
$$ language plpgsql security definer set search_path = public;

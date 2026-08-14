-- Transactional estimate editing. All row-version checks happen before any
-- write; settings, items, and financial audit evidence commit together.

create or replace function public.save_estimate_version(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text,
  p_expected_version_revision integer,
  p_settings jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  version_row public.estimate_versions%rowtype;
  estimate_row public.estimates%rowtype;
  item_json jsonb;
  item_id uuid;
  expected_item_revision integer;
  before_item public.estimate_items%rowtype;
  after_item public.estimate_items%rowtype;
  clear_price boolean;
  saved_ids uuid[] := '{}';
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Estimate items must be an array';
  end if;

  select ev.* into version_row
  from public.estimate_versions ev
  join public.estimates e on e.id = ev.estimate_id
  where ev.id = p_version_id and e.tenant_id = p_tenant_id
  for update of ev;
  if not found then raise exception 'Estimate version not found for tenant'; end if;
  if version_row.status not in ('draft', 'review') then raise exception 'Estimate version is not editable'; end if;
  if version_row.row_version <> p_expected_version_revision then
    raise exception 'Estimate changed since it was loaded. Reload and try again';
  end if;
  select * into estimate_row from public.estimates where id = version_row.estimate_id;

  -- Lock and validate every target before the first mutation. A stale row in
  -- a batch aborts the entire transaction, preventing partial saves.
  for item_json in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    item_id := (item_json ->> 'id')::uuid;
    expected_item_revision := nullif(item_json ->> 'expected_row_version', '')::integer;
    select * into before_item from public.estimate_items where id = item_id for update;
    if expected_item_revision is null then
      if found then raise exception 'New estimate item id already exists'; end if;
    else
      if not found or before_item.tenant_id <> p_tenant_id or before_item.estimate_version_id <> p_version_id then
        raise exception 'Estimate item does not belong to this version';
      end if;
      if before_item.row_version <> expected_item_revision then
        raise exception 'Estimate item changed since it was loaded. Reload and try again';
      end if;
    end if;
  end loop;

  if coalesce(p_settings, '{}'::jsonb) <> '{}'::jsonb then
    update public.estimate_versions set
      contingency_pct = case when p_settings ? 'contingency_pct' then (p_settings ->> 'contingency_pct')::numeric else contingency_pct end,
      overhead_pct = case when p_settings ? 'overhead_pct' then (p_settings ->> 'overhead_pct')::numeric else overhead_pct end,
      profit_pct = case when p_settings ? 'profit_pct' then (p_settings ->> 'profit_pct')::numeric else profit_pct end,
      row_version = row_version + 1
    where id = p_version_id;
  end if;

  for item_json in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    item_id := (item_json ->> 'id')::uuid;
    expected_item_revision := nullif(item_json ->> 'expected_row_version', '')::integer;
    clear_price := coalesce((item_json ->> 'clear_price_evidence')::boolean, true);
    select * into before_item from public.estimate_items where id = item_id;

    if expected_item_revision is null then
      insert into public.estimate_items (
        id, tenant_id, project_id, estimate_version_id, cost_code, description, scope_category,
        quantity, uom, labor_cost, material_cost, equipment_cost, trucking_cost, subcontract_cost,
        disposal_cost, testing_cost, other_direct_cost, total_direct_cost, indirect_cost, contingency,
        overhead, profit, total_price, unit_price, notes, assumptions, exclusions, is_allowance,
        is_alternate, alternate_accepted, sort_order, pricing_status, row_version, created_by, updated_by
      ) values (
        item_id, p_tenant_id, estimate_row.project_id, p_version_id, item_json ->> 'cost_code',
        item_json ->> 'description', item_json ->> 'scope_category', (item_json ->> 'quantity')::numeric,
        item_json ->> 'uom', coalesce((item_json ->> 'labor_cost')::numeric, 0),
        coalesce((item_json ->> 'material_cost')::numeric, 0), coalesce((item_json ->> 'equipment_cost')::numeric, 0),
        coalesce((item_json ->> 'trucking_cost')::numeric, 0), coalesce((item_json ->> 'subcontract_cost')::numeric, 0),
        coalesce((item_json ->> 'disposal_cost')::numeric, 0), coalesce((item_json ->> 'testing_cost')::numeric, 0),
        coalesce((item_json ->> 'other_direct_cost')::numeric, 0), coalesce((item_json ->> 'total_direct_cost')::numeric, 0),
        coalesce((item_json ->> 'indirect_cost')::numeric, 0), coalesce((item_json ->> 'contingency')::numeric, 0),
        coalesce((item_json ->> 'overhead')::numeric, 0), coalesce((item_json ->> 'profit')::numeric, 0),
        coalesce((item_json ->> 'total_price')::numeric, 0), coalesce((item_json ->> 'unit_price')::numeric, 0),
        item_json ->> 'notes', item_json ->> 'assumptions', item_json ->> 'exclusions',
        coalesce((item_json ->> 'is_allowance')::boolean, false), coalesce((item_json ->> 'is_alternate')::boolean, false),
        coalesce((item_json ->> 'alternate_accepted')::boolean, false), coalesce((item_json ->> 'sort_order')::integer, 0),
        'manual', 0, p_actor_user_id, p_actor_user_id
      ) returning * into after_item;
    else
      update public.estimate_items set
        cost_code = item_json ->> 'cost_code', description = item_json ->> 'description', scope_category = item_json ->> 'scope_category',
        quantity = (item_json ->> 'quantity')::numeric, uom = item_json ->> 'uom',
        labor_cost = coalesce((item_json ->> 'labor_cost')::numeric, 0), material_cost = coalesce((item_json ->> 'material_cost')::numeric, 0),
        equipment_cost = coalesce((item_json ->> 'equipment_cost')::numeric, 0), trucking_cost = coalesce((item_json ->> 'trucking_cost')::numeric, 0),
        subcontract_cost = coalesce((item_json ->> 'subcontract_cost')::numeric, 0), disposal_cost = coalesce((item_json ->> 'disposal_cost')::numeric, 0),
        testing_cost = coalesce((item_json ->> 'testing_cost')::numeric, 0), other_direct_cost = coalesce((item_json ->> 'other_direct_cost')::numeric, 0),
        total_direct_cost = coalesce((item_json ->> 'total_direct_cost')::numeric, 0), indirect_cost = coalesce((item_json ->> 'indirect_cost')::numeric, 0),
        contingency = coalesce((item_json ->> 'contingency')::numeric, 0), overhead = coalesce((item_json ->> 'overhead')::numeric, 0),
        profit = coalesce((item_json ->> 'profit')::numeric, 0), total_price = coalesce((item_json ->> 'total_price')::numeric, 0),
        unit_price = coalesce((item_json ->> 'unit_price')::numeric, 0), notes = item_json ->> 'notes', assumptions = item_json ->> 'assumptions',
        exclusions = item_json ->> 'exclusions', is_allowance = coalesce((item_json ->> 'is_allowance')::boolean, false),
        is_alternate = coalesce((item_json ->> 'is_alternate')::boolean, false), alternate_accepted = coalesce((item_json ->> 'alternate_accepted')::boolean, false),
        sort_order = coalesce((item_json ->> 'sort_order')::integer, 0), updated_by = p_actor_user_id, row_version = row_version + 1,
        pricing_status = case when clear_price then 'manual' else pricing_status end,
        price_observation_id = case when clear_price then null else price_observation_id end,
        price_source_snapshot = case when clear_price then null else price_source_snapshot end,
        pricing_effective_date = case when clear_price then null else pricing_effective_date end,
        pricing_confidence = case when clear_price then null else pricing_confidence end
      where id = item_id
      returning * into after_item;
    end if;

    insert into public.estimate_audit_log (
      tenant_id, project_id, estimate_id, estimate_version_id, entity_type, entity_id,
      action, actor_user_id, before, after
    ) values (
      p_tenant_id, estimate_row.project_id, version_row.estimate_id, p_version_id, 'item', item_id,
      case when expected_item_revision is null then 'created' else 'updated' end,
      p_actor_user_id, case when expected_item_revision is null then null else to_jsonb(before_item) end, to_jsonb(after_item)
    );
    saved_ids := array_append(saved_ids, item_id);
  end loop;

  select * into version_row from public.estimate_versions where id = p_version_id;
  return jsonb_build_object(
    'version', to_jsonb(version_row),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order, i.created_at)
      from public.estimate_items i where i.id = any(saved_ids)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_estimate_version(uuid, uuid, text, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_estimate_version(uuid, uuid, text, integer, jsonb, jsonb) to service_role;

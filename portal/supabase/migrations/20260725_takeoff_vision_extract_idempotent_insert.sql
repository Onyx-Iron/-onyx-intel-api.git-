-- Milestone 1.2 hardening: apply_vision_extraction_takeoff_items was atomic
-- per-call (single transaction), but two concurrent calls for the same page
-- (e.g. a double-click on "refresh", or a retried request after a timeout)
-- could each pass the decided_keys check before either committed its INSERT,
-- producing duplicate "suggested" rows for the same finding. A partial
-- unique index plus ON CONFLICT DO NOTHING makes a second concurrent call
-- for the same undecided finding a no-op instead of a duplicate.
create unique index if not exists idx_takeoff_items_undecided_page_item_key
  on takeoff_items (tenant_id, document_id, (meta->>'vision_page_id'), (meta->>'item_key'))
  where review_status in ('suggested', 'reviewed');

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
      source_method, confidence_score, geometry, meta
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
        'geometry_unavailable', true, 'item_key', item_key
      )
    )
    -- Idempotency guard: if a concurrent call already inserted this exact
    -- undecided finding for this page (see idx_takeoff_items_undecided_page_item_key
    -- above), skip it instead of creating a duplicate row.
    on conflict (tenant_id, document_id, (meta->>'vision_page_id'), (meta->>'item_key'))
    where review_status in ('suggested', 'reviewed')
    do nothing;

    if found then
      insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, after)
      values (p_tenant_id, p_project_id, new_id, 'created', null, jsonb_build_object('source', 'ai_vision', 'page_id', p_page_id));
    end if;
  end loop;

  return query
    select * from takeoff_items
    where tenant_id = p_tenant_id and document_id = p_document_id::text
      and (meta->>'vision_page_id') = p_page_id::text;
end;
$$;

-- Milestone-1 validation pass (punch list P-01/P-02/P-03): the previous
-- vision-extract "refresh" flow deleted ALL prior AI-vision rows for a page
-- and reinserted the fresh extraction, destroying any approve/reject
-- decisions an estimator had already made, and doing so via a non-atomic
-- delete-then-insert sequence from the API route (a crash mid-sequence could
-- leave a page with no takeoff rows at all). This function performs the
-- purge-undecided / preserve-decided / insert-new-only-if-undecided logic in
-- a single transaction, matched via a stable content key
-- (description|quantity|unit) rather than array position.
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
  -- Already-decided rows (approved/rejected) for this page are never
  -- touched — their content key is remembered so a re-extracted finding
  -- that matches one is skipped rather than re-inserted as a duplicate.
  select coalesce(array_agg(
    lower(trim(label)) || '|' || round(coalesce(quantity, 0), 4)::text || '|' || lower(trim(coalesce(unit, '')))
  ), array[]::text[])
  into decided_keys
  from takeoff_items
  where tenant_id = p_tenant_id
    and document_id = p_document_id::text
    and (meta->>'vision_page_id') = p_page_id::text
    and review_status in ('approved', 'rejected');

  -- Purge only the undecided (suggested/reviewed) rows for this page —
  -- these are safe to replace with a fresh extraction. Each purge is logged
  -- to takeoff_item_history so the deletion is auditable.
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
    );
    insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, after)
    values (p_tenant_id, p_project_id, new_id, 'created', null, jsonb_build_object('source', 'ai_vision', 'page_id', p_page_id));
  end loop;

  return query
    select * from takeoff_items
    where tenant_id = p_tenant_id and document_id = p_document_id::text
      and (meta->>'vision_page_id') = p_page_id::text;
end;
$$;

-- P-05: takeoff_items.meta is queried by content (vision_page_id, item_key)
-- on every vision-extract GET/POST — without an index this was a full-table
-- jsonb scan per request.
create index if not exists idx_takeoff_items_meta_gin on takeoff_items using gin (meta);

-- P-08: takeoff_item_history.takeoff_item_id deliberately has no foreign key
-- to takeoff_items — a hard delete of a takeoff item must not cascade-delete
-- (or be blocked by) its own audit trail. Documented here so a future
-- migration doesn't "fix" this as an oversight.
comment on column takeoff_item_history.takeoff_item_id is
  'Intentionally NOT a foreign key to takeoff_items.id — history rows must survive a hard delete of the item they describe, so the audit trail is not lost or cascade-deleted along with it.';

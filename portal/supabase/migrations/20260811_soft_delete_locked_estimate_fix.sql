-- Fix: soft_delete_manual_takeoff_tx hard-deletes the mirrored takeoff_items
-- row, but estimate_items.source_takeoff_id has `ON DELETE SET NULL` — when
-- that mirror was already synced into an APPROVED (locked) estimate
-- version, Postgres's own FK cascade performs an UPDATE on the linked
-- estimate_items row (setting source_takeoff_id to null), which trips the
-- prevent_locked_estimate_item_write trigger and raises an exception,
-- rolling back the ENTIRE delete. Caught by a live-database integration
-- test before this ever shipped: deleting any manual takeoff whose mirror
-- had already been priced into an approved estimate would fail outright.
--
-- Fix: before hard-deleting the mirror, check whether it's still
-- referenced by an estimate_items row belonging to a LOCKED
-- (approved/superseded/void) version. If so, the mirror is left in place —
-- its approved estimate linkage must remain completely untouched (STEP 9/
-- RULE 9), so the mirror itself can't be removed either without touching
-- that linkage. The manual_takeoffs source row is still soft-deleted and
-- audited normally; only the (already-priced, now orphaned-from-an-active-
-- source) mirror survives, by design, as the estimate's own historical
-- record of what it was priced from. If the mirror has no locked
-- references (only draft/review ones, or none at all), it is hard-deleted
-- exactly as before — draft-linked estimate_items get reconciled by the
-- outbox worker's delete-event handler regardless.

create or replace function soft_delete_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text
) returns table (already_deleted boolean, manual_takeoff jsonb) as $$
declare
  v_before manual_takeoffs;
  v_after  manual_takeoffs;
  v_mirror_id uuid;
  v_locked_reference_count integer;
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
    select count(*) into v_locked_reference_count
      from estimate_items ei
      join estimate_versions ev on ev.id = ei.estimate_version_id
      where ei.source_takeoff_id = v_mirror_id
        and ev.status in ('approved', 'superseded', 'void');

    if v_locked_reference_count = 0 then
      insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before)
        select p_tenant_id, v_after.project_id, ti.id, 'deleted', p_actor_user_id, to_jsonb(ti)
        from takeoff_items ti where ti.id = v_mirror_id;
      delete from takeoff_items where id = v_mirror_id;
    else
      -- Deliberately NOT deleted: the mirror is still referenced by a
      -- locked estimate version, and any write that touches it (even an
      -- FK-cascaded SET NULL from deleting it) would mutate that locked
      -- version's estimate_items row — forbidden. Audited as 'updated'
      -- (not 'deleted') to reflect that the row itself survives.
      insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
        select p_tenant_id, v_after.project_id, ti.id, 'updated', p_actor_user_id, to_jsonb(ti),
          jsonb_build_object('note', 'source manual takeoff soft-deleted; mirror retained because it is referenced by a locked estimate version')
        from takeoff_items ti where ti.id = v_mirror_id;
    end if;
  end if;

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (p_tenant_id, v_after.project_id, p_id, 'delete', 'pending', jsonb_build_object('mirror_id', v_mirror_id, 'mirror_retained', coalesce(v_locked_reference_count, 0) > 0), now())
  on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;

  return query select false, to_jsonb(v_after);
end;
$$ language plpgsql security definer set search_path = public;

-- Reliability: restore_manual_takeoff_tx + documentation for outbox cron.
--
-- Soft-delete already supports history action 'restored' (CHECK on
-- manual_takeoff_history) but no RPC existed to clear deleted_at, recreate
-- the takeoff_items mirror, and enqueue an estimate-sync upsert. Without
-- this, a mistaken soft-delete was only recoverable via raw SQL.
--
-- Periodic outbox re-drive is handled by Vercel Cron hitting
-- POST /api/internal/outbox/process (see portal/vercel.json). Optional
-- pg_cron + pg_net remains available for self-hosted setups; do not hardcode
-- a production app URL in migrations.

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

  select * into v_mirror_before from takeoff_items where source_manual_takeoff_id = v_after.id;

  insert into takeoff_items (
    tenant_id, project_id, label, csi_code, division, quantity, unit, type, page,
    document_id, sheet_id, geometry, created_by, review_status, source_method, meta,
    source_manual_takeoff_id
  ) values (
    p_tenant_id, v_after.project_id, v_label, v_after.cost_code, v_division,
    v_after.quantity, v_after.unit, 'takeoff_import', 0,
    null, v_after.page_id, v_after.geometry,
    case when v_is_vision then null else p_actor_user_id end,
    'approved',
    case when v_is_vision then 'ai_vision' else 'manual' end,
    jsonb_build_object(
      'extraction_method', case when v_is_vision then 'ai_vision' else 'manual' end,
      'manual_takeoff_id', v_after.id
    ),
    v_after.id
  )
  on conflict (source_manual_takeoff_id) where source_manual_takeoff_id is not null do update set
    label = excluded.label, csi_code = excluded.csi_code, division = excluded.division,
    quantity = excluded.quantity, unit = excluded.unit, geometry = excluded.geometry,
    updated_by = p_actor_user_id, updated_at = now()
  returning id into v_mirror_id;

  insert into takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
  values (
    p_tenant_id, v_after.project_id, v_mirror_id,
    case when v_mirror_before.id is null then 'created' else 'updated' end,
    p_actor_user_id,
    case when v_mirror_before.id is null then null else to_jsonb(v_mirror_before) end,
    jsonb_build_object('source', 'manual_canvas_restore', 'manual_takeoff_id', v_after.id)
  );

  insert into estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  values (
    p_tenant_id, v_after.project_id, v_after.id, 'upsert', 'pending',
    jsonb_build_object('mirror_id', v_mirror_id, 'restored', true), now()
  )
  on conflict (manual_takeoff_id, event_type) where status in ('pending', 'processing') do update set
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = null;

  return query select false, to_jsonb(v_after), v_mirror_id;
end;
$$ language plpgsql security definer set search_path = public;

REVOKE EXECUTE ON FUNCTION public.restore_manual_takeoff_tx(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_manual_takeoff_tx(uuid, uuid, text) TO service_role;

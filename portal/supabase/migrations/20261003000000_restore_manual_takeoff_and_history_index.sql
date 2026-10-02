-- Restore a soft-deleted manual takeoff and index the history lookup the
-- estimate outbox uses to find the deleted mirror.

CREATE INDEX IF NOT EXISTS idx_takeoff_item_history_deleted_source_manual
  ON public.takeoff_item_history (tenant_id, (before->>'source_manual_takeoff_id'))
  WHERE action = 'deleted';

CREATE OR REPLACE FUNCTION public.restore_manual_takeoff_tx(
  p_id uuid,
  p_tenant_id uuid,
  p_actor_user_id text
) RETURNS TABLE (already_active boolean, manual_takeoff jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before manual_takeoffs;
  v_after manual_takeoffs;
  v_mirror_before takeoff_items;
  v_mirror_id uuid;
  v_division text;
BEGIN
  SELECT * INTO v_before FROM manual_takeoffs WHERE id = p_id AND tenant_id = p_tenant_id;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'manual takeoff % not found for this tenant', p_id;
  END IF;

  IF v_before.deleted_at IS NULL THEN
    RETURN QUERY SELECT true, to_jsonb(v_before);
    RETURN;
  END IF;

  UPDATE manual_takeoffs
    SET deleted_at = NULL,
        updated_by = p_actor_user_id,
        updated_at = now(),
        row_version = row_version + 1
    WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_after;

  INSERT INTO manual_takeoff_history (tenant_id, project_id, manual_takeoff_id, action, actor_user_id, before, after)
  VALUES (p_tenant_id, v_after.project_id, p_id, 'restored', p_actor_user_id, to_jsonb(v_before), to_jsonb(v_after));

  -- A pending delete would undo this restore if the worker ran it later.
  UPDATE estimate_sync_outbox
    SET status = 'processed',
        processed_at = now(),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('superseded_by', 'restore')
    WHERE manual_takeoff_id = p_id
      AND event_type = 'delete'
      AND status IN ('pending', 'failed');

  v_division := CASE WHEN v_after.cost_code IS NOT NULL THEN left(v_after.cost_code, 2) ELSE NULL END;
  SELECT * INTO v_mirror_before FROM takeoff_items WHERE source_manual_takeoff_id = v_after.id;

  INSERT INTO takeoff_items (
    tenant_id, project_id, label, csi_code, division, quantity, unit, type, page,
    document_id, sheet_id, geometry, created_by, review_status, source_method, meta,
    source_manual_takeoff_id
  ) VALUES (
    p_tenant_id, v_after.project_id, 'Manual takeoff item', v_after.cost_code, v_division,
    v_after.quantity, v_after.unit, 'takeoff_import', 0,
    NULL, v_after.page_id, v_after.geometry,
    p_actor_user_id, 'approved', 'manual',
    jsonb_build_object('extraction_method', 'manual', 'manual_takeoff_id', v_after.id),
    v_after.id
  )
  ON CONFLICT (source_manual_takeoff_id) WHERE source_manual_takeoff_id IS NOT NULL DO UPDATE SET
    label = excluded.label,
    csi_code = excluded.csi_code,
    division = excluded.division,
    quantity = excluded.quantity,
    unit = excluded.unit,
    geometry = excluded.geometry,
    updated_by = p_actor_user_id,
    updated_at = now()
  RETURNING id INTO v_mirror_id;

  INSERT INTO takeoff_item_history (tenant_id, project_id, takeoff_item_id, action, actor_user_id, before, after)
  VALUES (
    p_tenant_id, v_after.project_id, v_mirror_id,
    CASE WHEN v_mirror_before.id IS NULL THEN 'created' ELSE 'updated' END,
    p_actor_user_id,
    CASE WHEN v_mirror_before.id IS NULL THEN NULL ELSE to_jsonb(v_mirror_before) END,
    jsonb_build_object('source', 'restore', 'manual_takeoff_id', v_after.id)
  );

  INSERT INTO estimate_sync_outbox (tenant_id, project_id, manual_takeoff_id, event_type, status, payload, created_at)
  VALUES (p_tenant_id, v_after.project_id, v_after.id, 'upsert', 'pending', jsonb_build_object('mirror_id', v_mirror_id), now())
  ON CONFLICT (manual_takeoff_id, event_type) WHERE status IN ('pending', 'processing') DO UPDATE SET
    status = 'pending', payload = excluded.payload, created_at = now(), next_attempt_at = NULL;

  RETURN QUERY SELECT false, to_jsonb(v_after);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_manual_takeoff_tx(uuid, uuid, text) FROM public, anon, authenticated;

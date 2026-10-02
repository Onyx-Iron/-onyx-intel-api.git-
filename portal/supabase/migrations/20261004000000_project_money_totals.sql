-- Project overview money in one query. The previous route downloaded up to
-- 5000 estimate rows and 5000 change-order rows just to multiply and sum them.
CREATE OR REPLACE FUNCTION public.project_money_totals(p_tenant_id uuid, p_project_id uuid)
RETURNS TABLE (
  estimate_value numeric,
  change_orders_pending bigint,
  change_orders_approved bigint,
  pending_change_order_value numeric,
  approved_change_order_value numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE((
      SELECT SUM(quantity * unit_cost)
      FROM public.estimate_items
      WHERE tenant_id = p_tenant_id
        AND project_id = p_project_id
        AND quantity IS NOT NULL
        AND unit_cost IS NOT NULL
    ), 0),
    COALESCE((
      SELECT COUNT(*)
      FROM public.change_order_items
      WHERE tenant_id = p_tenant_id
        AND project_id = p_project_id
        AND status = 'pending'
    ), 0),
    COALESCE((
      SELECT COUNT(*)
      FROM public.change_order_items
      WHERE tenant_id = p_tenant_id
        AND project_id = p_project_id
        AND status = 'approved'
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM public.change_order_items
      WHERE tenant_id = p_tenant_id
        AND project_id = p_project_id
        AND status = 'pending'
    ), 0),
    COALESCE((
      SELECT SUM(COALESCE(amount, 0))
      FROM public.change_order_items
      WHERE tenant_id = p_tenant_id
        AND project_id = p_project_id
        AND status = 'approved'
    ), 0);
$$;

REVOKE ALL ON FUNCTION public.project_money_totals(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_money_totals(uuid, uuid) TO service_role;

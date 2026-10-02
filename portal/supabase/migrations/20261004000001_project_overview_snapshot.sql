-- One round trip for the project overview. Each table is scanned once.
-- Money rules match project_money_totals: estimate rows need both quantity
-- and unit cost, and a null change-order amount counts as zero.
CREATE OR REPLACE FUNCTION public.project_overview_snapshot(p_tenant_id uuid, p_project_id uuid)
RETURNS TABLE (
  takeoff_items bigint,
  documents bigint,
  schedule_tasks bigint,
  schedule_complete bigint,
  contacts bigint,
  daily_logs bigint,
  generated_docs bigint,
  procurement_total bigint,
  procurement_pending bigint,
  punch_total bigint,
  punch_open bigint,
  permits_total bigint,
  permits_approved bigint,
  rfis_open bigint,
  submittals_open bigint,
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
    takeoff.c,
    docs.c,
    schedule.total,
    schedule.done,
    contact.c,
    daily.c,
    generated.c,
    procurement.total,
    procurement.pending,
    punch.total,
    punch.open,
    permits.total,
    permits.approved,
    rfi.open,
    submittal.open,
    estimate.value,
    change_order.pending_count,
    change_order.approved_count,
    change_order.pending_value,
    change_order.approved_value
  FROM
    (SELECT COUNT(*) AS c
       FROM public.takeoff_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) takeoff,
    (SELECT COUNT(*) AS c
       FROM public.documents
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) docs,
    (SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'complete') AS done
       FROM public.schedule_tasks
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) schedule,
    (SELECT COUNT(*) AS c
       FROM public.contacts
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) contact,
    (SELECT COUNT(*) AS c
       FROM public.daily_logs
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) daily,
    (SELECT COUNT(*) AS c
       FROM public.generated_documents
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) generated,
    (SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'pending') AS pending
       FROM public.procurement_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) procurement,
    (SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) AS open
       FROM public.punch_list_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) punch,
    (SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved
       FROM public.permit_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) permits,
    (SELECT COUNT(*) FILTER (WHERE status IN ('open', 'answered')) AS open
       FROM public.rfi_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) rfi,
    (SELECT COUNT(*) FILTER (WHERE status IN ('submitted', 'under_review', 'revise_resubmit', 'rejected')) AS open
       FROM public.submittal_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) submittal,
    (SELECT COALESCE(SUM(quantity * unit_cost) FILTER (
              WHERE quantity IS NOT NULL AND unit_cost IS NOT NULL
            ), 0) AS value
       FROM public.estimate_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) estimate,
    (SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
            COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
            COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE status = 'pending'), 0) AS pending_value,
            COALESCE(SUM(COALESCE(amount, 0)) FILTER (WHERE status = 'approved'), 0) AS approved_value
       FROM public.change_order_items
      WHERE tenant_id = p_tenant_id AND project_id = p_project_id) change_order;
$$;

REVOKE ALL ON FUNCTION public.project_overview_snapshot(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_overview_snapshot(uuid, uuid) TO service_role;

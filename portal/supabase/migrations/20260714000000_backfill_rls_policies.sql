-- Security advisor found 36 tables with RLS enabled but zero policies —
-- these fail closed (all access silently blocked), which is safe but breaks
-- any code path relying on RLS (Studio, PostgREST, GraphQL, or future
-- direct-client code) rather than the service-role backend. Backfill real
-- tenant-scoped policies matching the pattern used everywhere else in this
-- schema. All application writes already go through the service-role
-- client (which bypasses RLS by design) — these policies are the same
-- defense-in-depth layer as the rest of the schema, not the primary
-- enforcement mechanism.

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'agent_runs', 'ai_agent_audit_trails', 'audit_logs', 'change_order_items',
    'civil_construction_entrances', 'civil_material_ledger', 'civil_pipe_runs',
    'civil_stockpiles', 'civil_surfaces', 'co_inspections', 'companies',
    'company_users', 'cost_actuals', 'cost_overrides', 'cut_fill_computations',
    'cut_fill_surfaces', 'document_chunks', 'earthwork_volumes',
    'equipment_suppliers', 'invoices', 'lien_waivers', 'material_vendors',
    'project_events', 'project_financial_settings', 'project_risk_digests',
    'rfi_items', 'roles', 'sheet_calibrations', 'staff_members',
    'submittal_items', 'todo_items', 'weekly_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON public.%I', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON public.%I FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id())', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation_update ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())', tbl);
    EXECUTE format('CREATE POLICY tenant_isolation_delete ON public.%I FOR DELETE USING (tenant_id = public.current_tenant_id())', tbl);
  END LOOP;
END $$;

-- Global catalog tables (no tenant_id — shared reference data across every
-- tenant): readable by any authenticated org member, writes reserved for
-- the service-role backend, matching cost_assemblies/commodity_trend_series.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['cost_codes', 'cost_indices', 'cost_prices']
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS catalog_read ON public.%I', tbl);
    EXECUTE format('CREATE POLICY catalog_read ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', tbl);
  END LOOP;
END $$;

-- tenants: a caller may only see their own tenant row (id = current_tenant_id(),
-- not tenant_id — tenants.id IS the tenant identifier).
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_select ON public.tenants;
CREATE POLICY self_select ON public.tenants FOR SELECT USING (id = public.current_tenant_id());

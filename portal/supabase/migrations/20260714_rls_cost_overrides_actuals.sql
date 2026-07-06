-- cost_overrides and cost_actuals (20260702_cost_catalog_v2.sql) both carry a
-- tenant_id column but were never enrolled in the tenant-isolation RLS policy
-- set added in 20260706_rls_tenant_isolation.sql. App routes are safe today
-- (service-role key bypasses RLS; app code filters by tenant_id explicitly),
-- but without RLS here, any other access path — Studio, direct PostgREST with
-- an anon/authenticated key, a future client-side Supabase call — could read
-- or write another tenant's pricing overrides or actual-cost history.
--
-- cost_codes, cost_prices, and cost_indices are intentionally left out: they
-- are shared reference data (CSI dictionary, regional market pricing, BLS/ENR
-- indices), not tenant-owned rows.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['cost_overrides', 'cost_actuals']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON public.%I FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON public.%I FOR DELETE USING (tenant_id = public.current_tenant_id())',
      tbl
    );
  END LOOP;
END $$;

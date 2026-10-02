-- CRITICAL: manual_measurements had a policy named
-- "tenant_isolation_manual_measurements" but its actual USING/WITH CHECK
-- expressions were both literal `true` for ALL commands — a complete
-- tenant-isolation bypass despite the name (any tenant could read/write any
-- other tenant's manual measurement data). Replace with real per-command
-- tenant-scoped policies matching the rest of the schema.
ALTER TABLE public.manual_measurements FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_manual_measurements ON public.manual_measurements;
CREATE POLICY tenant_isolation_select ON public.manual_measurements FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.manual_measurements FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.manual_measurements FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.manual_measurements FOR DELETE USING (tenant_id = public.current_tenant_id());

-- Let tenants.self_select honor app.clerk_org_id (GUC) in addition to JWT org_id.
--
-- current_tenant_id() only reads auth.jwt()->>'org_id'. Recovered
-- tenant_isolation_* ALL policies set/read app.clerk_org_id and subquery
-- public.tenants; without this GUC match, those subqueries see zero rows
-- for GUC-only sessions (even after EXECUTE on current_tenant_id is restored
-- by 20261006000000_restore_current_tenant_id_execute.sql).

DROP POLICY IF EXISTS self_select ON public.tenants;
CREATE POLICY self_select ON public.tenants FOR SELECT TO authenticated
USING (
  id = public.current_tenant_id()
  OR clerk_org_id = nullif(current_setting('app.clerk_org_id', true), '')
);

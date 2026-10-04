-- tenants.self_select must also honor app.clerk_org_id (the GUC used by the
-- recovered ALL-command policies and by supabase/tests/tenant_isolation.test.sql).
-- current_tenant_id() only reads auth.jwt()->>'org_id', so a GUC-only session
-- would otherwise see zero tenant rows inside policy subqueries even with
-- EXECUTE restored on current_tenant_id().

DROP POLICY IF EXISTS self_select ON public.tenants;
CREATE POLICY self_select ON public.tenants FOR SELECT TO authenticated
USING (
  id = public.current_tenant_id()
  OR clerk_org_id = nullif(current_setting('app.clerk_org_id', true), '')
);

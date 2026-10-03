-- Restore authenticated EXECUTE on public.current_tenant_id().
--
-- 20260803191017 revoked this after dropping authenticated table grants,
-- assuming the helper was unused. That was incorrect for the RLS backstop:
--   1) tenants.self_select still calls current_tenant_id()
--   2) recovered tenant_isolation_* ALL policies subquery public.tenants,
--      which evaluates self_select under the caller's role
--   3) dozens of select/insert/update/delete policies still reference
--      current_tenant_id() directly
--
-- Production still flags authenticated_security_definer_function_executable
-- on this function (intentional — see MIGRATION_REPLAY_RESULTS.md). Local
-- replay must match that grant or XD-14 pgTAP fails with:
--   ERROR: permission denied for function current_tenant_id
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;

-- tenants.self_select must also honor app.clerk_org_id (the GUC used by the
-- recovered ALL-command policies and by supabase/tests/tenant_isolation.test.sql).
-- current_tenant_id() only reads auth.jwt()->>'org_id', so a GUC-only session
-- would otherwise see zero tenant rows inside policy subqueries even with
-- EXECUTE restored.
DROP POLICY IF EXISTS self_select ON public.tenants;
CREATE POLICY self_select ON public.tenants FOR SELECT TO authenticated
USING (
  id = public.current_tenant_id()
  OR clerk_org_id = nullif(current_setting('app.clerk_org_id', true), '')
);

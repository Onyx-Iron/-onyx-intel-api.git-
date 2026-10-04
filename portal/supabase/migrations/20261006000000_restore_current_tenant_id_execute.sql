-- Restore EXECUTE on public.current_tenant_id() for authenticated.
--
-- 20260803191017_close_remaining_supabase_advisors.sql revoked this after
-- removing authenticated table grants, assuming the helper was unused. That
-- was incorrect: RLS policies still invoke it, including:
--   - public.tenants.self_select (id = current_tenant_id())
--   - many tenant_isolation_{select,insert,update,delete} policies
--
-- When authenticated runs a query whose policies call the helper (or whose
-- clerk_org_id policies subquery tenants, which then hits self_select),
-- Postgres raises "permission denied for function current_tenant_id" and
-- aborts — even if another permissive policy would have allowed the row.
--
-- 20260714000003_restrict_security_definer_functions.sql already documented
-- that authenticated must keep EXECUTE. Re-grant here; keep anon/PUBLIC
-- revoked so the advisor finding for anon stays closed. Isolation is
-- unchanged: the function still returns NULL without a recognized org claim.

REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

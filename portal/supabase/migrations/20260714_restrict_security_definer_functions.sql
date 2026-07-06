-- current_tenant_id() is invoked BY our own RLS policies for the
-- `authenticated` role — that grant must stay or every policy referencing
-- it breaks with a permission error for that role. `anon` never carries a
-- valid Clerk org_id JWT claim, so it gets nothing useful from this
-- function anyway; revoke there per the advisor finding.
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

-- rls_auto_enable() is an event-trigger function — Postgres invokes it
-- automatically on DDL, it is never called directly by any client role.
-- No legitimate reason for anon/authenticated to have direct EXECUTE.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, PUBLIC;

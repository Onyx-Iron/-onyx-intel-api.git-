-- current_tenant_id() is invoked BY our own RLS policies for the
-- `authenticated` role — that grant must stay or every policy referencing
-- it breaks with a permission error for that role. `anon` never carries a
-- valid Clerk org_id JWT claim, so it gets nothing useful from this
-- function anyway; revoke there per the advisor finding.
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated, service_role;

-- rls_auto_enable() is created later in
-- `20260812000000_baseline_foreign_keys_functions_and_triggers.sql`, which
-- also applies the REVOKE after CREATE. Do not REVOKE it here — the function
-- does not exist yet on a fresh migration replay.

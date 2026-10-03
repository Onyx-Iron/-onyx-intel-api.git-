-- Teach current_tenant_id() to honor the app.clerk_org_id GUC used by the
-- recovered ALL-command RLS policies (20260812) and pgTAP isolation suite.
--
-- Production PostgREST paths still prefer Clerk JWT org_id. The GUC is the
-- documented stand-in for SET ROLE authenticated tests and any future
-- request-scoped tenant binding that cannot mint a JWT claim.
--
-- SECURITY DEFINER + search_path=public: the tenants lookup bypasses RLS on
-- tenants (exact same privilege model as the original helper).
--
-- Execute grants are intentionally unchanged from
-- 20260803191017_close_remaining_supabase_advisors.sql (service_role only in
-- production; pgTAP re-grants authenticated inside a rolled-back transaction).

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.tenants t
  WHERE t.clerk_org_id = COALESCE(
    NULLIF(auth.jwt() ->> 'org_id', ''),
    NULLIF(current_setting('app.clerk_org_id', true), '')
  )
  LIMIT 1;
$$;

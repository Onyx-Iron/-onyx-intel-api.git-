-- Clerk-org policies on projects, takeoff_items, and estimate_items resolve
-- the caller by reading public.tenants. That read is subject to tenants RLS.
-- self_select called public.current_tenant_id(), and authenticated lost
-- EXECUTE on that function in 20260803191017. The lookup then failed with
-- "permission denied for function current_tenant_id" instead of filtering.
--
-- Match the tenant from the same signals the rest of the schema already
-- uses: the app.clerk_org_id GUC, or the Clerk org claim on the JWT.
-- Do not call the revoked helper.

DROP POLICY IF EXISTS self_select ON public.tenants;
CREATE POLICY self_select ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    clerk_org_id = NULLIF(current_setting('app.clerk_org_id', true), '')
    OR clerk_org_id = NULLIF(auth.jwt() ->> 'org_id', '')
  );

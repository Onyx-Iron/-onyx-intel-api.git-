-- Close out the remaining Supabase advisors observed against production on
-- 2026-08-03. Production applied this through the Supabase MCP as
-- 20260803191017_close_remaining_supabase_advisors; later recovered local
-- migrations must keep this cleaned-up grant/policy shape intact.

-- Security advisor: the immutability trigger function was created without a
-- pinned search_path. Pinning schema resolution does not change trigger
-- behavior, but removes caller-controlled search path ambiguity.
ALTER FUNCTION public.prevent_locked_estimate_item_write()
  SET search_path = public, pg_temp;

-- Performance advisor: manual_measurements.project_id needs a leading-column
-- covering index for its FK. The existing lookup index starts with tenant_id,
-- so it is not a covering index for project_id-only FK checks.
CREATE INDEX IF NOT EXISTS idx_manual_measurements_project_id
  ON public.manual_measurements(project_id);

-- This app's runtime table access goes through the service-role backend, not
-- direct browser/anon Supabase table queries. Remove the final authenticated
-- table grants so catalog/tenant tables are no longer discoverable through
-- GraphQL/Data API roles.
REVOKE SELECT ON TABLE
  public.assembly_components,
  public.commodity_trend_series,
  public.cost_assemblies,
  public.cost_codes,
  public.cost_indices,
  public.cost_prices,
  public.tenants
FROM authenticated;

-- With all authenticated table grants removed, authenticated callers no
-- longer need to execute the SECURITY DEFINER tenant helper directly.
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO service_role;

-- Replace catalog policies that used auth.role() inside the USING clause with
-- role-scoped policies. The table grants above remain revoked; these policies
-- are only a future guardrail if catalog access is deliberately re-granted.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'assembly_components',
    'commodity_trend_series',
    'cost_assemblies',
    'cost_codes',
    'cost_indices',
    'cost_prices'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS catalog_read ON public.%I', tbl);
    EXECUTE format(
      'CREATE POLICY catalog_read ON public.%I FOR SELECT TO authenticated USING (true)',
      tbl
    );
  END LOOP;
END $$;

-- Replace service-role-only policies that called auth.role() per row with
-- role-scoped policies. service_role bypasses RLS, but keeping the policies
-- explicit makes the intended access model visible in schema introspection.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND qual = '(auth.role() = ''service_role''::text)'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      r.policyname,
      r.tablename
    );
  END LOOP;
END $$;

-- Rewrite app.clerk_org_id tenant policies so current_setting() is evaluated
-- once per statement instead of once per row. This covers both production's
-- currently-applied policy set and the broader recovered local replay set.
DO $$
DECLARE
  r record;
  tenant_expr constant text :=
    'tenant_id IN (SELECT t.id FROM public.tenants t WHERE t.clerk_org_id = (SELECT current_setting(''app.clerk_org_id'', true)))';
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'ALL'
      AND qual ILIKE '%current_setting%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
      r.policyname,
      r.tablename,
      tenant_expr,
      tenant_expr
    );
  END LOOP;
END $$;

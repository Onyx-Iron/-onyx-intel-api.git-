-- Strict multi-tenant RLS across all project-scoped tables.
--
-- Auth model: the app's Next.js server routes run under the Supabase
-- service-role key, which bypasses RLS by design (Postgres grants it
-- BYPASSRLS) — tenant isolation there is enforced in application code via
-- explicit `.eq("tenant_id", tenantId)` filters. These policies are the
-- second line of defense: they protect every OTHER access path — the
-- Supabase Studio "authenticated" role, direct PostgREST calls made with an
-- anon/authenticated key, and any future client-side Supabase usage — so a
-- bug or a new code path can never leak another tenant's rows.
--
-- `public.current_tenant_id()` resolves the caller's tenant from the Clerk
-- organization claim forwarded in the JWT (`org_id`), via Supabase's
-- Clerk third-party auth integration. It intentionally returns NULL for any
-- request that isn't carrying a recognized Clerk org claim, which makes
-- every policy below deny-by-default.
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id
  FROM public.tenants t
  WHERE t.clerk_org_id = (auth.jwt() ->> 'org_id')
  LIMIT 1;
$$;

-- ── project_rfis / project_change_orders don't exist yet — create them with
-- the tenant/project scoping columns the RLS policies below depend on. ──
CREATE TABLE IF NOT EXISTS public.project_rfis (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subject      text,
  question     text,
  answer       text,
  status       text NOT NULL DEFAULT 'open',
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_rfis_project ON public.project_rfis(project_id);
CREATE INDEX IF NOT EXISTS idx_project_rfis_tenant  ON public.project_rfis(tenant_id);

CREATE TABLE IF NOT EXISTS public.project_change_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  co_number    text,
  description  text,
  amount       numeric DEFAULT 0,
  status       text NOT NULL DEFAULT 'pending',
  created_by   text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_change_orders_project ON public.project_change_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_project_change_orders_tenant  ON public.project_change_orders(tenant_id);

-- ── Enable RLS + strict tenant-scoped policies on all six tables ──────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'documents', 'document_pages', 'project_estimates',
    'manual_takeoffs', 'project_rfis', 'project_change_orders'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON public.%I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON public.%I', tbl);

    EXECUTE format(
      'CREATE POLICY tenant_isolation_select ON public.%I FOR SELECT USING (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_insert ON public.%I FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_update ON public.%I FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id())',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation_delete ON public.%I FOR DELETE USING (tenant_id = public.current_tenant_id())',
      tbl
    );
  END LOOP;
END $$;

-- project_profiles holds sensitive role/user mapping — tenant-scope it like
-- the other project tables.
ALTER TABLE public.project_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.project_profiles;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.project_profiles;
DROP POLICY IF EXISTS tenant_isolation_update ON public.project_profiles;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.project_profiles;
CREATE POLICY tenant_isolation_select ON public.project_profiles FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.project_profiles FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.project_profiles FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.project_profiles FOR DELETE USING (tenant_id = public.current_tenant_id());

-- cost_assemblies / assembly_components are a shared catalog (no tenant_id
-- column) — readable by any authenticated org member, writes reserved for
-- the trusted service-role backend (no INSERT/UPDATE/DELETE policy for
-- "authenticated" means those are denied by default once RLS is enabled).
ALTER TABLE public.cost_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_assemblies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_read ON public.cost_assemblies;
CREATE POLICY catalog_read ON public.cost_assemblies FOR SELECT USING (auth.role() = 'authenticated');

ALTER TABLE public.assembly_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assembly_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_read ON public.assembly_components;
CREATE POLICY catalog_read ON public.assembly_components FOR SELECT USING (auth.role() = 'authenticated');

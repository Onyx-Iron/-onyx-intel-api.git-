-- Area Bounds takeoff: site clearing / stripping / paving / flatwork
-- boundary polygons drawn on the sheet canvas.
CREATE TABLE IF NOT EXISTS public.civil_area_limits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  project_id         uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  page_id            uuid,
  boundary_kind      text NOT NULL CHECK (boundary_kind IN (
                       'topsoil_stripping', 'building_pad', 'asphalt_paving', 'concrete_flatwork'
                     )),
  area_sf            numeric NOT NULL,
  stripping_depth_in numeric DEFAULT 6,
  excavation_volume_cy numeric,
  target_cost_code   text,
  boundary_geometry  jsonb NOT NULL,        -- { points: [{x,y}], page_number }
  created_by         text,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_civil_area_limits_project ON public.civil_area_limits(project_id, page_id);
CREATE INDEX IF NOT EXISTS idx_civil_area_limits_tenant  ON public.civil_area_limits(tenant_id);

ALTER TABLE public.civil_area_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_area_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.civil_area_limits;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.civil_area_limits;
DROP POLICY IF EXISTS tenant_isolation_update ON public.civil_area_limits;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.civil_area_limits;
CREATE POLICY tenant_isolation_select ON public.civil_area_limits FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.civil_area_limits FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.civil_area_limits FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.civil_area_limits FOR DELETE USING (tenant_id = public.current_tenant_id());

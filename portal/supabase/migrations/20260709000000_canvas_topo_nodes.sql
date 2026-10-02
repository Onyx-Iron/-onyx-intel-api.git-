-- Topographic contour lines + spot elevations drawn on the sheet canvas.
-- tenant_id/project_id are added beyond the spec's literal column list so
-- this table follows the same tenant-isolation + RLS posture as every other
-- canvas table (civil_utility_takeoffs, manual_takeoffs, etc).
CREATE TABLE IF NOT EXISTS public.canvas_topo_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  page_id         uuid NOT NULL,
  node_type       text NOT NULL CHECK (node_type IN ('contour_line', 'spot_elevation')),
  elevation       numeric NOT NULL,
  geometry        jsonb NOT NULL,           -- { points: [{x,y}], page_number }
  layer_assignment text,                    -- e.g. "C-TOPO", "PGCONT", or "manual"
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_canvas_topo_nodes_page ON public.canvas_topo_nodes(page_id);
CREATE INDEX IF NOT EXISTS idx_canvas_topo_nodes_project ON public.canvas_topo_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_canvas_topo_nodes_tenant  ON public.canvas_topo_nodes(tenant_id);

ALTER TABLE public.canvas_topo_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_topo_nodes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.canvas_topo_nodes;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.canvas_topo_nodes;
DROP POLICY IF EXISTS tenant_isolation_update ON public.canvas_topo_nodes;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.canvas_topo_nodes;
CREATE POLICY tenant_isolation_select ON public.canvas_topo_nodes FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.canvas_topo_nodes FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.canvas_topo_nodes FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.canvas_topo_nodes FOR DELETE USING (tenant_id = public.current_tenant_id());

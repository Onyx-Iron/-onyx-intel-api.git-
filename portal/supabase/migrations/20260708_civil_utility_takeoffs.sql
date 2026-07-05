-- Linear utility takeoffs (sanitary sewer, storm drain, water, fire line)
-- drawn as pipe runs on the sheet canvas. Distinct from `manual_takeoffs`
-- because a utility run carries pipe-specific trench engineering data
-- (inverts, diameter, computed embedment volumes) that count/length/area
-- takeoffs don't need.
CREATE TABLE IF NOT EXISTS public.civil_utility_takeoffs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  project_id             uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  page_id                uuid,
  cost_code              text,
  -- `utility_type` is the derived hydraulic classification (gravity vs.
  -- pressure); `system_type` is the specific system the estimator picked in
  -- the input modal (Sanitary Sewer / Storm Drain / Water Line / Fire Line).
  utility_type           text,
  system_type            text NOT NULL,
  invert_elevation_start numeric,
  invert_elevation_end   numeric,
  pipe_diameter_in       integer NOT NULL,
  trench_width_ft        numeric NOT NULL,
  run_length_lf          numeric NOT NULL,
  computed_trench_json   jsonb,
  geometry               jsonb,
  created_by             text,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_civil_utility_takeoffs_project ON public.civil_utility_takeoffs(project_id, page_id);
CREATE INDEX IF NOT EXISTS idx_civil_utility_takeoffs_tenant  ON public.civil_utility_takeoffs(tenant_id);

ALTER TABLE public.civil_utility_takeoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.civil_utility_takeoffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON public.civil_utility_takeoffs;
DROP POLICY IF EXISTS tenant_isolation_insert ON public.civil_utility_takeoffs;
DROP POLICY IF EXISTS tenant_isolation_update ON public.civil_utility_takeoffs;
DROP POLICY IF EXISTS tenant_isolation_delete ON public.civil_utility_takeoffs;
CREATE POLICY tenant_isolation_select ON public.civil_utility_takeoffs FOR SELECT USING (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_insert ON public.civil_utility_takeoffs FOR INSERT WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_update ON public.civil_utility_takeoffs FOR UPDATE USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY tenant_isolation_delete ON public.civil_utility_takeoffs FOR DELETE USING (tenant_id = public.current_tenant_id());
